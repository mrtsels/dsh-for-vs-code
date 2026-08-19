# Changelog

All notable changes to **DeepSeek Harness for VS Code** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-08-18

### Added

- Chat 面板：上游原生 React UI，对话/子代理/后台任务/Todo/Goal/Trajectory 全功能
- 主题同步：上游语义色全量映射 VS Code 主题变量，跟随 VS Code 配色
- 首开体验：首次打开自动进入当前工作区的新会话
- 设置映射：agentPreset / permissionMode / locale / theme / busyEnter 双向同步
- 改动审查：agent 写盘快照捕获 → diff 面板 → 一键回滚/接受
- 编辑器上下文：Ask 时自动注入当前文件/诊断；问 git 时注入工作区改动摘要
- 文件/选区附着：拖拽文件到输入区附着为 chip，支持活动文件/选区附着
- 审批：工具请求执行时弹出原生通知
- 终端：面板内命令输入，输出可捕获回传 UI
- 原生入口：VS Code Chat 面板 `@DeepSeek Harness`、编辑器右键「dsh：解释选中代码 / Ask to fix 诊断」
- 连接管理：切换实例地址、重试连接、验证连接
- 会话管理页：独立页面管理会话列表（新建/切换/重命名/分叉/归档）
- 代理预设选择：从实例 preset 名册选择默认 agent preset
