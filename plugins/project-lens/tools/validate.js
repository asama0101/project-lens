// 使い方: node tools/validate.js <data.json> [--mine <個人ファイル>]   結果を JSON で出力し、errors があれば exit 1
// 共有ファイルと個人ファイルを合わせて検証する。個人ファイルは、同じフォルダの personal.json（無ければ空として扱う）。別の場所なら --mine。
import { readData, takeMineOrExit } from "./cli.js";
import { validate } from "../src/core/schema.js";

const { mine, rest: [path] } = takeMineOrExit(process.argv.slice(2));
if (!path) { console.error("使い方: node tools/validate.js <data.json> [--mine <個人ファイル>]"); process.exit(2); }
let data;
try { data = readData(path, mine); } // BOM は readData が除く（画面・他の CLI と同じ）
catch (e) { console.log(JSON.stringify({ errors: [`読み込めません: ${e.message}`], warnings: [] }, null, 2)); process.exit(1); }
const r = validate(data);
console.log(JSON.stringify(r, null, 2));
process.exit(r.errors.length ? 1 : 0);
