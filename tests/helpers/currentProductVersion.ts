import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 原生验收读取本次构建的产品版本，避免发行版本更新后仍绑定旧标签。 */
export const currentProductVersion = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version as string;
