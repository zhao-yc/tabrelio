import { queryResultSortZh as text } from './locales/queryResultSort.zh-CN';

type PostgresResultIdentifierType = 'UUID' | 'INET' | 'CIDR';

export function isPostgresResultIdentifierType(type: string): type is PostgresResultIdentifierType {
  return type === 'UUID' || type === 'INET' || type === 'CIDR';
}

const invalidAddress = () => Error(text.postgresAddressValue);

/** 点分输入按十进制解析，避免 URL 的八进制、主机名和缺段补全规则。 */
function ipv4Octets(value: string, embedded = false): number[] {
  const parts = value.split('.');
  const octet = embedded ? /^(?:0|[1-9]\d{0,2})$/ : /^\d+$/;
  if (parts.length > 4 || parts.some(part => !octet.test(part) || Number(part) > 255)) throw invalidAddress();
  return parts.map(Number);
}

function ipv4(value: string, prefix: number | undefined, cidr: boolean): { hex: string; bits: number } {
  const octets = cidr && /^0x[0-9a-f]{1,8}$/i.test(value)
    ? (value.slice(2).match(/.{1,2}/g) ?? []).map(part => parseInt(part.padEnd(2, '0'), 16))
    : ipv4Octets(value);
  const first = octets[0];
  // CIDR 省略掩码时沿用 PostgreSQL 的 IPv4 有类网络默认值，已写出的字节可能扩大掩码。
  const classBits = first >= 240 ? 32 : first >= 224 ? 8 : first >= 192 ? 24 : first >= 128 ? 16 : 8;
  const inferred = first === 224 && octets.length === 1 ? 4 : Math.max(classBits, octets.length * 8);
  const bits = prefix ?? (cidr ? inferred : 32);
  if (bits > 32 || !cidr && Math.floor(bits / 8) > octets.length) throw invalidAddress();
  return { hex: octets.map(byte => byte.toString(16).padStart(2, '0')).join('').padEnd(8, '0'), bits };
}

function ipv6(value: string): string {
  if (value.includes('.')) {
    // IPv4 尾段仍属于 IPv6。将其展开为两个 16 位段后再处理零压缩。
    const separator = value.lastIndexOf(':');
    const octets = ipv4Octets(value.slice(separator + 1), true);
    while (octets.length < 4) octets.push(0);
    const [a, b, c, d] = octets;
    value = value.slice(0, separator + 1) + (a * 256 + b).toString(16) + ':' + (c * 256 + d).toString(16);
  }
  const halves = value.split('::');
  const [left, right] = halves.map(part => part ? part.split(':') : []);
  const missing = 8 - left.length - (right?.length ?? 0);
  if (halves.length > 2 || (right ? missing < 1 : missing !== 0)) throw invalidAddress();
  const words = right ? [...left, ...Array<string>(missing).fill('0'), ...right] : left;
  if (words.some(word => !/^[a-f0-9]{1,4}$/i.test(word))) throw invalidAddress();
  return words.map(word => word.toLowerCase().padStart(4, '0')).join('');
}

/** 只生成比较键。原值用于显示、复制、导出及服务器筛选参数。 */
export function postgresResultIdentifierOrder(value: string, type: PostgresResultIdentifierType): string {
  if (type === 'UUID') {
    const body = value.startsWith('{') && value.endsWith('}') ? value.slice(1, -1) : value;
    if (!/^[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}$/i.test(body)) throw Error(text.postgresUuidValue);
    return body.replace(/-/g, '').toLowerCase();
  }
  const [address, suffix, extra] = value.split('/');
  const v6 = address.includes(':');
  if (extra !== undefined || suffix !== undefined && !(v6 ? /^(?:0|[1-9]\d{0,2})$/ : /^\d+$/).test(suffix)) throw invalidAddress();
  const prefix = suffix === undefined ? undefined : Number(suffix);
  const { hex, bits } = v6 ? { hex: ipv6(address), bits: prefix ?? 128 } : ipv4(address, prefix, type === 'CIDR');
  if (bits > 128) throw invalidAddress();
  const addressBits = BigInt('0x' + hex);
  const hostBits = BigInt(hex.length * 4 - bits);
  const masked = (addressBits >> hostBits) << hostBits;
  if (type === 'CIDR' && masked !== addressBits) throw invalidAddress();
  // 同族内先比较公共前缀。短前缀补零后必然小于或等于其子网，相等时按前缀长度和完整地址继续比较。
  return (v6 ? '6' : '4') + masked.toString(16).padStart(hex.length, '0') + bits.toString(16).padStart(2, '0') + hex;
}
