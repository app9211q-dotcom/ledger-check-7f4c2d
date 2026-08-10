#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledgerPath = path.join(repoDir, "ledger.json");
const validTypes = new Set(["loan", "repayment"]);
const typeAliases = new Map([
  ["loan", "loan"],
  ["borrow", "loan"],
  ["借款", "loan"],
  ["转账", "loan"],
  ["repayment", "repayment"],
  ["payment", "repayment"],
  ["还款", "repayment"],
]);

const todayInShanghai = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const parseFlags = (args) => {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const name = value.slice(2);
    if (name === "publish") {
      flags.publish = true;
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`参数 --${name} 缺少值`);
    flags[name] = next;
    index += 1;
  }
  return { positional, flags };
};

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const validateLedger = (ledger) => {
  if (!ledger || !isValidDate(ledger.updatedAt) || !Array.isArray(ledger.records)) {
    throw new Error("ledger.json 顶层格式不正确");
  }
  const ids = new Set();
  for (const record of ledger.records) {
    if (!record.id || ids.has(record.id)) throw new Error(`记录 ID 重复或缺失：${record.id || "空"}`);
    if (record.date !== null && !isValidDate(record.date)) throw new Error(`记录日期不正确：${record.id}`);
    if (!validTypes.has(record.type)) throw new Error(`记录类型不正确：${record.id}`);
    if (!Number.isSafeInteger(record.amount) || record.amount <= 0) throw new Error(`记录金额不正确：${record.id}`);
    if (typeof record.note !== "string") throw new Error(`记录备注不正确：${record.id}`);
    ids.add(record.id);
  }
};

const totalsFor = (ledger) => {
  const loan = ledger.records.filter((record) => record.type === "loan").reduce((sum, record) => sum + record.amount, 0);
  const repayment = ledger.records.filter((record) => record.type === "repayment").reduce((sum, record) => sum + record.amount, 0);
  return { loan, repayment, balance: loan - repayment, count: ledger.records.length };
};

const loadLedger = async () => {
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  validateLedger(ledger);
  return ledger;
};

const saveLedger = async (ledger) => {
  validateLedger(ledger);
  const temporaryPath = `${ledgerPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await rename(temporaryPath, ledgerPath);
};

const nextId = (ledger, date, type, amount) => {
  const datePart = date ? date.replaceAll("-", "") : "undated";
  const prefix = `${datePart}-${type}-${amount}-`;
  const suffixes = ledger.records
    .map((record) => record.id)
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter(Number.isSafeInteger);
  const next = String((suffixes.length ? Math.max(...suffixes) : 0) + 1).padStart(2, "0");
  return `${prefix}${next}`;
};

const publishLedger = (message) => {
  execFileSync("git", ["add", "ledger.json"], { cwd: repoDir, stdio: "pipe" });
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: repoDir, stdio: "pipe" });
    return false;
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  execFileSync("git", ["commit", "-m", message], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["push", "origin", "main"], { cwd: repoDir, stdio: "pipe" });
  return true;
};

const usage = () => {
  console.log(`用法：
  node scripts/update-ledger.mjs add <loan|repayment> <金额> [--date YYYY-MM-DD] [--note 备注] [--publish]
  node scripts/update-ledger.mjs remove <记录ID> [--publish]
  node scripts/update-ledger.mjs list
  node scripts/update-ledger.mjs check`);
};

const main = async () => {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const [command, ...values] = positional;
  const ledger = await loadLedger();

  if (command === "check") {
    console.log(JSON.stringify({ ok: true, updatedAt: ledger.updatedAt, totals: totalsFor(ledger) }));
    return;
  }

  if (command === "list") {
    const records = [...ledger.records].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    console.log(JSON.stringify({ ok: true, records, totals: totalsFor(ledger) }));
    return;
  }

  if (command === "add") {
    const [rawType, rawAmount] = values;
    const type = typeAliases.get(rawType);
    const amount = Number(rawAmount);
    const date = flags.date || todayInShanghai();
    if (!type) throw new Error(`不支持的记录类型：${rawType || "空"}`);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`金额必须是正整数：${rawAmount || "空"}`);
    if (!isValidDate(date)) throw new Error(`日期格式不正确：${date}`);
    const record = {
      id: nextId(ledger, date, type, amount),
      date,
      type,
      amount,
      note: flags.note || "",
    };
    ledger.records.push(record);
    ledger.updatedAt = todayInShanghai();
    await saveLedger(ledger);
    const published = flags.publish ? publishLedger(`记录${date}${type === "loan" ? "借款" : "还款"}${amount}元`) : false;
    console.log(JSON.stringify({ ok: true, action: "add", record, totals: totalsFor(ledger), published }));
    return;
  }

  if (command === "remove") {
    const [id] = values;
    const index = ledger.records.findIndex((record) => record.id === id);
    if (index === -1) throw new Error(`没有找到记录：${id || "空"}`);
    const [record] = ledger.records.splice(index, 1);
    ledger.updatedAt = todayInShanghai();
    await saveLedger(ledger);
    const published = flags.publish ? publishLedger(`删除${record.date || "日期不详"}${record.amount}元记录`) : false;
    console.log(JSON.stringify({ ok: true, action: "remove", record, totals: totalsFor(ledger), published }));
    return;
  }

  usage();
  process.exitCode = 1;
};

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
