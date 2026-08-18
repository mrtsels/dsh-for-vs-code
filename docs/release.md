# 发布文档(draft — G2 PASS 前不执行 tag)

## 本次发布内容(Route A UI 基座)

- **UI 改为上游原生组件源码构建**(Route A):vendor/deepseek-harness @ `47f94385`(0.1.0-rc.5)只读 submodule;
  `build-web-shell.mjs` 装配 `dist/web/dsh-shell`(index.html + boot 图 + 28 插件 bundle + shell.css),
  替代原 fetch+boot(已退役)。实测 rc.5 源码构建产物与 rc.6 npm 产物字节级一致。
- **定制 boot 图**:39→31 插件裁剪(设置/计划/交付物/工作流/agent-preset/权限预设/目录浏览器由 VS Code 原生层接管),
  与 `ref-graph-rc6.json` 精确断言;inject 边裁剪防 loader 等死。
  目录选择保留 `ui-directory-picker-native`(renderless occupant),排除 `ui-directory-picker-browse`(in-app 浏览器)。
- **侧边栏融合**:静态 shell.css 透明(html/body/#root + 布局 chrome),替代旧 DOM 启发式。
- **代理重定向**:`proxy.setTarget`(切换实例地址端口不变)。
- **清理**:自研聊天 UI(web/* 9 文件 + panel.ts)删除,仅保留 changes 审查面板;fetch-dsh-ui.mjs 退役。
- **验证**:G0 四门绿;smoke-shell.mjs headless E2E(渲染/RPC/WS/无冲突/透明)通过;@live 测试连真实 3080 通过;
  VSIX 127 文件 2.13MB(含全部 28 插件 + 补丁后的 connection)。

## 发布流程

```sh
# 0. 前置(仅 G2 PASS 后)
# 1. G0 全绿
pnpm typecheck && pnpm lint && pnpm test && pnpm build
# 2. UI 装配 + 冒烟
node apps/vscode/scripts/build-web-shell.mjs
node apps/vscode/scripts/smoke-shell.mjs          # 期望 SMOKE PASS
# 3. 打包
cd apps/vscode && npx vsce package --no-dependencies
# 4. 版本与 tag(v0.1.0 已被旧路线占用;本路线建议 v0.2.0)
#    提交 version bump(package.json apps/vscode)后:
git tag v0.2.0 && git push origin v0.2.0
# 5. 上传 VSIX 到 Release + SHA-256
shasum -a 256 apps/vscode/dsh-for-vscode-*.vsix
```

## 发布前检查清单(G2)

- [ ] docs/manual-tests/phase-5.md 全项人工过一遍(侧边栏渲染/会话/聊天/审批/审查面板/连接管理)
- [ ] G1 审查 PASS(docs/reviews/phase-5.md)
- [ ] G0 四门绿 + smoke-shell PASS + @live 4/4
- [ ] VSIX 打包成功且含 dsh-shell 28 插件
- [ ] 无 API key/凭据进包;无 node_modules/src/web 泄露
