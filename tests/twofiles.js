// テスト用: 分割前の形のデータを、2 ファイル（data.json と personal.json）で置く・合わせて読む。
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { splitData, mergeData } from "../plugins/project-lens/src/core/split.js";

const j = (v) => JSON.stringify(v, null, 2) + "\n";
/** 結合したデータを data.json と personal.json に分けて書く（data は data.json のパス） */
export function writeTwo(data, merged, personalPath = join(dirname(data), "personal.json")) {
  const { shared, personal } = splitData(merged);
  writeFileSync(data, j(shared));
  writeFileSync(personalPath, j(personal));
}
const rd = (p) => JSON.parse(readFileSync(p, "utf8"));
/** 2 ファイルを合わせた結合データ */
export function readTwo(data, personalPath = join(dirname(data), "personal.json")) {
  return mergeData(rd(data), rd(personalPath));
}
/** 2 ファイルの中身を続けた文字列（変わっていないことの比較用） */
export function rawTwo(data, personalPath = join(dirname(data), "personal.json")) {
  return readFileSync(data, "utf8") + (existsSync(personalPath) ? readFileSync(personalPath, "utf8") : "");
}
