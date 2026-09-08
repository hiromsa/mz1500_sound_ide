/**
 * アプリケーションのバージョン・著作権・クレジット情報定義
 * 
 * バージョン運用ルール (Pattern 1 + 2 Hybrid):
 * `v<Major>.<Minor>.<Patch>-beta.<CommitCount>+<ShortHash>`
 * コミット時に CommitCount (+1) と直前 HEAD の ShortHash を更新します。
 */

export const APP_VERSION_BASE = '0.0.1-beta';
export const APP_BUILD_NUMBER = 86;
export const APP_COMMIT_HASH = '8192b06';

/** SemVer 準拠のフルバージョン表記 (例: 0.0.1-beta.69+18a7f84) */
export const APP_VERSION = `${APP_VERSION_BASE}.${APP_BUILD_NUMBER}+${APP_COMMIT_HASH}`;

/** ヘッダーやステータスバー向けの短縮表示 (例: v0.0.1-beta.69) */
export const APP_DISPLAY_VERSION = `v${APP_VERSION_BASE}.${APP_BUILD_NUMBER}`;

/** About モーダル等の詳細表示 (例: v0.0.1-beta.69 (18a7f84)) */
export const APP_FULL_DISPLAY_VERSION = `v${APP_VERSION_BASE}.${APP_BUILD_NUMBER} (${APP_COMMIT_HASH})`;

export const APP_NAME = 'MZ-1500 Sound IDE';
export const APP_DESCRIPTION = 'SHARP MZ-1500 Sound Driver & MML Compiler / DAW Studio';
export const APP_COPYRIGHT = '© 2026 ほたて';
export const APP_LICENSE = 'MIT License';

export interface RespectItem {
  name: string;
  role: string;
  url: string;
  urlLabel?: string;
  description: string;
  highlight?: string;
}

export const RESPECT_ITEMS: RespectItem[] = [
  {
    name: 'Konamiman 氏',
    role: 'Z80 CPU エミュレーションコア (Z80.Net)',
    url: 'https://github.com/Konamiman/Z80dotNet',
    urlLabel: 'github.com/Konamiman/Z80dotNet',
    description: 'C# で開発された高精度 Z80 エミュレーションライブラリ「Z80dotNet」を TypeScript へ移植・改変して内蔵 Z80 ドライバ実行エンジンとして活用させていただいております。',
    highlight: 'TypeScript Port',
  },
  {
    name: 'ぽよこまだんな 氏',
    role: 'ハードウェア協賛 / FM音源ボード (ACZ-8BS1MZ)',
    url: 'https://x.com/poyokoma_danna',
    urlLabel: 'x.com/poyokoma_danna',
    description: 'MZ-1500 用 FM音源ボード（ACZ-8BS1MZ / YM2151）の実機ボードをご提供いただきました。OPM 音源対応および実機動作確認において多大なるご協力をいただいております。',
    highlight: 'Hardware Sponsor',
  },
  {
    name: 'AKD 氏',
    role: '技術資料 / MZ-1500 関連情報',
    url: 'https://mzakd.cool.coocan.jp/',
    urlLabel: 'mzakd.cool.coocan.jp',
    description: 'MZ-1500 のハードウェア構造、MLD / Quick Disk 関連の仕様やシステム解析など、詳細かつ貴重な技術資料・Webサイトを参考にさせていただきました。',
    highlight: 'Technical Reference',
  },
  {
    name: '紅茶羊羹 氏',
    role: '技術資料 / MZシリーズ・音源技術解説',
    url: 'http://www.maroon.dti.ne.jp/youkan/mz700/index.html',
    urlLabel: 'maroon.dti.ne.jp/youkan/mz700',
    description: 'MZ シリーズの内部構造やサウンド制御、プログラミング技術に関する卓越した解説・技術資料のサイトを参考にさせていただきました。',
    highlight: 'Technical Reference',
  },
];
