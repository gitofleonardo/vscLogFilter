# 开发规范

## 测试要求（必须遵守）

### 1. 改功能时同步补测试

- 新增或修改行为（解析、过滤、求值、Worker、会话等）时，**必须**在 `test/` 中补充或更新对应用例。
- 优先覆盖：正常路径、边界（空输入、尾随 `|`/`&`）、与 Android Studio Logcat 语义相关的回归、以及本次修复前会失败的反例。
- 查询语法变更应对齐 `reference/as-logcat/` 的预期，并在测试中写明关键场景（如显式 OR、同 key 隐式 OR）。

### 2. 功能改完后跑全量测试

在认为改动完成、准备交付或提交前，**必须**在仓库根目录执行：

```bash
npm test
```

- 全量套件须全部通过，不得只跑单个文件就结束。
- 若全量失败：先修代码或测试，再重新跑通；不要带着红测合并/提交。

### 建议流程

1. 实现功能或修复  
2. 补充 / 更新测试  
3. `npm test`（全量）通过  
4. 再整理提交 / PR  

## 常用命令

```bash
npm install
npm run build
npm test
```

在 VS Code 中按 F5 启动 Extension Development Host 做手工验证。

---

English: [DEVELOPMENT.md](DEVELOPMENT.md)
