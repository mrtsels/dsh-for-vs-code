/**
 * attachment-format.test.ts — Phase 10 纯函数单测(parseUriList/fence/truncate/binary/
 * 选区工具/发送上下文格式化/composeFinalMessage)。
 */
import { describe, expect, it } from 'vitest';
import {
  composeFinalMessage,
  formatSendContext,
  formatSize,
  isWholeFileSelection,
  looksBinary,
  makeFence,
  nameFromUri,
  parseUriList,
  toSelectionInfo,
  truncateText,
} from '../src/vscode/attachment-format.js';

/** 反引号(避免在测试源里直接写 ` 与模板冲突) */
const BT = String.fromCharCode(96);

describe('parseUriList(text/uri-list)', () => {
  it('单 URI', () => {
    expect(parseUriList('file:///a/b.ts')).toEqual(['file:///a/b.ts']);
  });
  it('多 URI(CRLF)', () => {
    const list = 'file:///a/1.ts\r\nfile:///a/2.ts\r\n';
    expect(parseUriList(list)).toEqual(['file:///a/1.ts', 'file:///a/2.ts']);
  });
  it('LF 与尾随空行', () => {
    expect(parseUriList('file:///a/1.ts\nfile:///a/2.ts\n\n')).toEqual(['file:///a/1.ts', 'file:///a/2.ts']);
  });
  it('重复 URI 去重', () => {
    expect(parseUriList('file:///a/1.ts\nfile:///a/1.ts')).toEqual(['file:///a/1.ts']);
  });
  it('注释行(#)与空行跳过', () => {
    const list = '# comment\nfile:///a/1.ts\n\n# another\nfile:///a/2.ts';
    expect(parseUriList(list)).toEqual(['file:///a/1.ts', 'file:///a/2.ts']);
  });
  it('percent-encoded URI 原样保留(不解码)', () => {
    expect(parseUriList('file:///a/my%20file.ts')).toEqual(['file:///a/my%20file.ts']);
  });
});

describe('nameFromUri', () => {
  it('普通文件', () => {
    expect(nameFromUri('file:///Users/a/project/src/a.ts')).toBe('a.ts');
  });
  it('percent-encoded 文件名解码', () => {
    expect(nameFromUri('file:///Users/a/my%20file.ts')).toBe('my file.ts');
  });
  it('无路径段回退整串', () => {
    expect(nameFromUri('file:///')).toBe('file:///');
  });
});

describe('makeFence', () => {
  it('正文无反引号 → 3 个', () => {
    expect(makeFence('plain')).toBe(BT.repeat(3));
  });
  it('正文含 3 连反引号 → 4 个', () => {
    expect(makeFence('a ' + BT.repeat(3) + ' b')).toBe(BT.repeat(4));
  });
  it('正文含 4 连反引号 → 5 个', () => {
    expect(makeFence('a ' + BT.repeat(4) + ' b')).toBe(BT.repeat(5));
  });
});

describe('truncateText', () => {
  it('未超限原样', () => {
    expect(truncateText('abc', 5)).toEqual({ text: 'abc', truncated: false });
  });
  it('恰好 20k 不截断', () => {
    const text = 'x'.repeat(20_000);
    expect(truncateText(text, 20_000)).toEqual({ text, truncated: false });
  });
  it('20k+1 截断并标记', () => {
    const { text, truncated } = truncateText('x'.repeat(20_001), 20_000);
    expect(truncated).toBe(true);
    expect(text.length).toBe(20_000);
  });
});

describe('looksBinary', () => {
  it('含 NUL 视为二进制', () => {
    expect(looksBinary(new Uint8Array([1, 2, 0, 3]))).toBe(true);
  });
  it('无 NUL 视为文本', () => {
    expect(looksBinary(new Uint8Array([104, 105, 10, 33]))).toBe(false);
  });
  it('空数组视为文本', () => {
    expect(looksBinary(new Uint8Array([]))).toBe(false);
  });
});

describe('formatSize', () => {
  it('B / KB / MB', () => {
    expect(formatSize(512)).toBe('512');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('toSelectionInfo', () => {
  it('0-based → 1-based', () => {
    const info = toSelectionInfo(2, 0, 4, 9, 'text');
    expect(info).toEqual({ startLine: 3, startCol: 1, endLine: 5, endCol: 10, text: 'text' });
  });
});

describe('isWholeFileSelection', () => {
  it('整文件选区识别', () => {
    expect(isWholeFileSelection({ startLine: 1, startCol: 1, endLine: 10, endCol: 41, text: '' }, 10, 40)).toBe(true);
  });
  it('部分选区不是整文件', () => {
    expect(isWholeFileSelection({ startLine: 1, startCol: 1, endLine: 5, endCol: 3, text: '' }, 10, 40)).toBe(false);
    expect(isWholeFileSelection({ startLine: 2, startCol: 1, endLine: 10, endCol: 41, text: '' }, 10, 40)).toBe(false);
  });
});

describe('formatSendContext', () => {
  const activeFile = { path: 'src/foo.ts', languageId: 'typescript', isDirty: true, isUntitled: false };
  const diagnostics = [{ file: 'src/foo.ts', line: 12, severity: 'error', message: 'boom' }];
  const gitChanges = [{ path: 'src/foo.ts', additions: 3, deletions: 1 }];

  it('空输入 → 空文本', () => {
    const { text } = formatSendContext({
      attachActiveFile: false,
      attachSelection: false,
      selections: [],
      selectionWholeFile: false,
      diagnostics: [],
      gitChanges: [],
      attachments: [],
    });
    expect(text).toBe('');
  });

  it('元数据(文件/诊断/git)总是注入;正文受开关控制', () => {
    const { text } = formatSendContext({
      activeFile,
      attachActiveFile: false,
      attachSelection: false,
      fullFileText: 'FILE_BODY',
      selections: [{ startLine: 3, startCol: 1, endLine: 5, endCol: 9, text: 'SEL_BODY' }],
      selectionWholeFile: false,
      diagnostics,
      gitChanges,
      attachments: [],
    });
    expect(text).toContain('<file>src/foo.ts</file>');
    expect(text).toContain('<language>typescript</language>');
    expect(text).toContain('<dirty>true</dirty>');
    expect(text).toContain('diagnostics:');
    expect(text).toContain('git working-tree changes:');
    expect(text).not.toContain('FILE_BODY'); // 开关关闭不注入正文
    expect(text).not.toContain('SEL_BODY');
  });

  it('attachActiveFile → full-file 注入', () => {
    const { text } = formatSendContext({
      activeFile,
      attachActiveFile: true,
      attachSelection: false,
      fullFileText: 'const a = 1;',
      selections: [],
      selectionWholeFile: false,
      diagnostics: [],
      gitChanges: [],
      attachments: [],
    });
    expect(text).toContain('<full-file>');
    expect(text).toContain('const a = 1;');
  });

  it('attachSelection → selection 块(含 index/range)', () => {
    const { text } = formatSendContext({
      activeFile,
      attachActiveFile: false,
      attachSelection: true,
      selections: [{ startLine: 3, startCol: 1, endLine: 5, endCol: 9, text: 'sel' }],
      selectionWholeFile: false,
      diagnostics: [],
      gitChanges: [],
      attachments: [],
    });
    expect(text).toContain('<selection index="1" range="3:1-5:9">');
    expect(text).toContain('sel');
  });

  it('选区覆盖整文件 → 只发 full-file(去重)', () => {
    const { text } = formatSendContext({
      activeFile,
      attachActiveFile: true,
      attachSelection: true,
      fullFileText: 'whole',
      selections: [{ startLine: 1, startCol: 1, endLine: 1, endCol: 6, text: 'whole' }],
      selectionWholeFile: true,
      diagnostics: [],
      gitChanges: [],
      attachments: [],
    });
    expect(text).toContain('<full-file>');
    expect(text).not.toContain('<selection');
  });

  it('附件:内容文件注入;过大/二进制/不可读 → note 不注入正文', () => {
    const { text, warnings } = formatSendContext({
      attachActiveFile: false,
      attachSelection: false,
      selections: [],
      selectionWholeFile: false,
      diagnostics: [],
      gitChanges: [],
      attachments: [
        { id: '1', name: 'config.json', displayPath: 'config.json', outsideWorkspace: false, body: { kind: 'content', text: '{"a":1}' } },
        { id: '2', name: 'big.log', displayPath: 'big.log', outsideWorkspace: true, body: { kind: 'too-large', size: 5 * 1024 * 1024 } },
        { id: '3', name: 'x.bin', displayPath: 'x.bin', outsideWorkspace: false, body: { kind: 'binary' } },
        { id: '4', name: 'gone.ts', displayPath: 'gone.ts', outsideWorkspace: false, body: { kind: 'unreadable', message: 'ENOENT' } },
      ],
    });
    expect(text).toContain('<attachments>');
    expect(text).toContain('{"a":1}');
    expect(text).toContain('too-large: 5.0 MB, content omitted');
    expect(text).toContain('binary file, content omitted');
    expect(text).toContain('unreadable: ENOENT');
    expect(text).toContain('outside-workspace="true"');
    expect(warnings.length).toBe(3);
  });

  it('附件正文 20k 截断', () => {
    const { text } = formatSendContext({
      attachActiveFile: false,
      attachSelection: false,
      selections: [],
      selectionWholeFile: false,
      diagnostics: [],
      gitChanges: [],
      attachments: [{ id: '1', name: 'a.ts', displayPath: 'a.ts', outsideWorkspace: false, body: { kind: 'content', text: 'x'.repeat(20_001) } }],
    });
    expect(text).toContain('file exceeded 20000 characters');
  });

  it('附件正文总量预算(100k):超预算的文件被省略并提示', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: 'f' + i,
      name: 'f' + i + '.ts',
      displayPath: 'f' + i + '.ts',
      outsideWorkspace: false,
      body: { kind: 'content' as const, text: 'y'.repeat(20_000) },
    }));
    const { text, warnings } = formatSendContext({
      attachActiveFile: false,
      attachSelection: false,
      selections: [],
      selectionWholeFile: false,
      diagnostics: [],
      gitChanges: [],
      attachments: many,
      caps: { perFileChars: 20_000, totalChars: 100_000 },
    });
    expect(text).toContain('some attachments omitted: total content exceeded the budget');
    expect(warnings.some((w) => w.includes('总量上限'))).toBe(true);
  });

  it('fence 动态增长:正文含反引号不破坏格式', () => {
    const { text } = formatSendContext({
      activeFile: { path: 'a.md', languageId: 'markdown', isDirty: false, isUntitled: false },
      attachActiveFile: true,
      attachSelection: false,
      fullFileText: BT.repeat(3) + 'js\ncode\n' + BT.repeat(3),
      selections: [],
      selectionWholeFile: false,
      diagnostics: [],
      gitChanges: [],
      attachments: [],
    });
    expect(text).toContain(BT.repeat(4)); // 4 连 fence 包住 3 连正文
  });
});

describe('composeFinalMessage', () => {
  it('上下文空 → 原样用户文本', () => {
    expect(composeFinalMessage('hello', '')).toBe('hello');
  });
  it('上下文非空 → 前缀 + 用户文本', () => {
    expect(composeFinalMessage('hello', '<editor-context>\n</editor-context>')).toBe(
      '<editor-context>\n</editor-context>\n\nhello',
    );
  });
});

