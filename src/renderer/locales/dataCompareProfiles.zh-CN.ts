import { fullQueryExportProfilesZh as common } from './fullQueryExportProfiles.zh-CN';

export const dataCompareProfilesZh = {
  ...common,
  title: '比较方案',
  hint: '在本机保存左右表和筛选条件。应用后请重新比较。',
  applied: '已应用方案，请重新比较',
  swap: '交换左侧与右侧',
};

export const dataCompareBatchProfilesZh = {
  ...dataCompareProfilesZh,
  title: '多表比较方案',
  hint: '在本机保存左右范围和表映射。载入后请手动开始比较。',
  applied: '已载入多表方案，请重新比较',
};
