# 往来账网站维护规则

- `ledger.json` 是唯一账目数据源；不要在 `index.html` 中手工填写记录或汇总金额。
- 用户说“又借给他 N 元”时，类型使用 `loan`；用户说“他还了 N 元”时，类型使用 `repayment`。
- 日期未特别说明时，使用 Asia/Shanghai 当天日期；备注只记录用户明确提供的信息。
- 新增并发布：`node scripts/update-ledger.mjs add <loan|repayment> <金额> --date YYYY-MM-DD --note "备注" --publish`
- 删除并发布：先运行 `node scripts/update-ledger.mjs list` 找到记录 ID，再运行 `node scripts/update-ledger.mjs remove <记录ID> --publish`。
- 发布前或只读核对：`node scripts/update-ledger.mjs check`。
- 脚本输出中的 `loan`、`repayment`、`balance` 分别是借出合计、还款合计、剩余欠款。
- 只提交本次账目文件，不改动无关文件。发布后检查 GitHub Pages 构建成功及线上金额。
