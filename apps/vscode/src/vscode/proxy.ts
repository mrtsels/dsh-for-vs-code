/**
 * proxy.ts — webview → 3080 的本地转发代理(Origin 栅栏绕行)。
 *
 * 背景:3080 的 /api 信任栅栏(api-request-trust)要求浏览器请求的 Origin 恰好
 * 等于 3080 同源(防 DNS rebinding / 跨站读取)。webview 页面源是
 * vscode-webview://<ext-id>,直连 3080 的 HTTP/WS 一律 403,导致 runtime 无法
 * 建立连接(工作区/会话数据拿不到)。
 *
 * 本代理在扩展进程内监听 127.0.0.1 随机端口:webview 的 runtime 连代理,
 * 代理把 HTTP 与 WebSocket 转发到目标实例,并把 origin/host/sec-fetch-site
 * 改写为目标同源 —— 栅栏视角这是一次同源请求。纯传输层,无业务逻辑、
 * 不缓存状态;响应加 CORS 头让 webview 可读。
 *
 * 目标地址来自 baseUrl 配置(默认 http://127.0.0.1:3080),端口 0 由 OS 分配。
 */

import * as http from 'node:http';
import * as net from 'node:net';
import { once } from 'node:events';

export class HttpProxy {
  private server?: http.Server;
  private target: URL;

  constructor(targetBase: string) {
    this.target = new URL(targetBase);
  }

  get baseUrl(): string {
    // 扩展注入给 webview 的地址(随机端口)
    const addr = this.server?.address();
    if (addr === undefined || addr === null || typeof addr === 'string') return '';
    return `http://127.0.0.1:${addr.port}`;
  }

  /** 切换转发目标(实例地址变化;端口不变,后续请求走新目标)。 */
  setTarget(targetBase: string): void {
    this.target = new URL(targetBase);
  }

  async start(): Promise<string> {
    if (this.server) return this.baseUrl;
    const server = http.createServer((req, res) => {
      void this.handleHttp(req, res);
    });
    // WS:webview runtime 的 mux/host 双通道
    server.on('upgrade', (req, socket, head) => {
      void this.handleUpgrade(req, socket, head);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    this.server = server;
    return this.baseUrl;
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = undefined;
    if (s) {
      s.close();
      s.closeAllConnections?.();
    }
  }

  private targetOrigin(): string {
    return this.target.origin;
  }

  /** 转发 HTTP(含 preflight)。改写 origin/host/sec-fetch-*;响应附加 CORS 头。 */
  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS preflight(webview 跨源到代理)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    // 读 body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const headers: http.OutgoingHttpHeaders = {
      ...req.headers,
      origin: this.targetOrigin(),
      host: this.target.host,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    };
    const upstream = http.request({
      protocol: this.target.protocol,
      hostname: this.target.hostname,
      port: this.target.port || 80,
      path: req.url,
      method: req.method,
      headers,
    });
    upstream.on('response', (upstreamRes) => {
      const outHeaders = { ...upstreamRes.headers, ...corsHeaders() };
      res.writeHead(upstreamRes.statusCode ?? 502, outHeaders);
      upstreamRes.pipe(res);
    });
    upstream.on('error', (err) => {
      res.writeHead(502, corsHeaders());
      res.end(`proxy error: ${err.message}`);
    });
    upstream.end(body);
  }

  /** 转发 WebSocket upgrade:原样透传握手头(改写 origin/host/sec-fetch),101 后双向管道。 */
  private async handleUpgrade(req: http.IncomingMessage, socket: net.Socket | import('node:stream').Duplex, head: Buffer): Promise<void> {
    const s = socket as net.Socket;
    const headers = { ...req.headers, origin: this.targetOrigin(), host: this.target.host, 'sec-fetch-site': 'same-origin' };
    const headLines = Object.entries(headers)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n');
    const handshake = `${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1\r\n${headLines}\r\n\r\n`;

    const upstream = net.connect({
      host: this.target.hostname,
      port: Number(this.target.port) || 80,
    });
    let phase: 'handshake' | 'relay' = 'handshake';
    let buffer = Buffer.alloc(0);
    let wroteStatus = false;

    upstream.on('connect', () => {
      upstream.write(handshake);
      if (head.length > 0) upstream.write(head);
    });
    upstream.on('data', (chunk: Buffer) => {
      if (phase === 'handshake') {
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const statusBlock = buffer.subarray(0, headerEnd + 4).toString('utf8');
        const rest = buffer.subarray(headerEnd + 4);
        if (!wroteStatus) {
          s.write(statusBlock);
          wroteStatus = true;
        }
        if (rest.length > 0) s.write(rest);
        phase = 'relay';
        return;
      }
      s.write(chunk);
    });
    s.on('data', (chunk: Buffer) => {
      if (phase === 'relay') upstream.write(chunk);
    });
    upstream.on('end', () => s.end());
    s.on('end', () => upstream.end());
    upstream.on('error', () => s.destroy());
    s.on('error', () => upstream.destroy());
  }
}

function corsHeaders(): http.OutgoingHttpHeaders {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,accept,x-requested-with',
  };
}
