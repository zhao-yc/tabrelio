import { postgresCreateTableZh as text } from '../locales/postgresCreateTable.zh-CN';

type Direction = -1 | 1;
type KeyField = { id: string; name: string };

/** 重排只改变所选字段 ID 的位置，调用方保留列定义和按 ID 保存的边界。 */
export function movePostgresCreateKey(ids: readonly string[], id: string, direction: Direction): string[] | undefined {
  const from = ids.indexOf(id), to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** 主键与分区键共用独立的顺序列表，每个按钮只移动对应字段一位。 */
export function PostgresCreateKeyOrder({ label, fields, onMove }: {
  label: string; fields: readonly KeyField[]; onMove(id: string, direction: Direction): void;
}) {
  if (fields.length < 2) return null;
  return <fieldset className="pg-create-field">
    <legend>{label}</legend>
    <ol>{fields.map((field, index) => <li key={field.id}>
      <span>{field.name || text.field(index + 1)}</span>{' '}
      <button type="button" disabled={index === 0} aria-label={text.keyOrderUp(label, index + 1)}
        onClick={() => onMove(field.id, -1)}>{text.keyUp}</button>{' '}
      <button type="button" disabled={index === fields.length - 1} aria-label={text.keyOrderDown(label, index + 1)}
        onClick={() => onMove(field.id, 1)}>{text.keyDown}</button>
    </li>)}</ol>
  </fieldset>;
}
