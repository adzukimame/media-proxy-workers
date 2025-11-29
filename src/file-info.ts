import { fileTypeFromBuffer } from 'file-type';
// import isSvg from 'is-svg';

const TYPE_OCTET_STREAM = {
  mime: 'application/octet-stream',
  ext: null,
};

// const TYPE_SVG = {
//   mime: 'image/svg+xml',
//   ext: 'svg',
// };

export async function detectType(buffer: ArrayBuffer): Promise<{
  mime: string;
  ext: string | null;
}> {
  // Check 0 byte
  const fileSize = buffer.byteLength;
  if (fileSize === 0) {
    return TYPE_OCTET_STREAM;
  }

  const type = await fileTypeFromBuffer(buffer);

  if (type) {
    // XMLはSVGかもしれない
    // if (type.mime === 'application/xml' && await checkSvg(buffer)) {
    //     return TYPE_SVG;
    // }

    if (!isMimeImage(type.mime, 'safe-file')) {
      return TYPE_OCTET_STREAM;
    }

    return {
      mime: fixMime(type.mime),
      ext: type.ext,
    };
  }

  // 種類が不明でもSVGかもしれない
  // if (await checkSvg(buffer)) {
  //     return TYPE_SVG;
  // }

  // それでも種類が不明なら application/octet-stream にする
  return TYPE_OCTET_STREAM;
}
// async function checkSvg(buffer: ArrayBuffer) {
//     try {
//         const size = buffer.byteLength;
//         if (size > 1 * 1024 * 1024) return false;
//         return isSvg(new TextDecoder().decode(buffer));
//     } catch {
//         return false;
//     }
// }

import { FILE_TYPE_BROWSERSAFE } from './const.js';

const dictionary = {
  'safe-file': FILE_TYPE_BROWSERSAFE,
  'sharp-convertible-image': ['image/jpeg', 'image/png', 'image/gif', 'image/apng', 'image/vnd.mozilla.apng', 'image/webp', 'image/avif', 'image/svg+xml', 'image/x-icon', 'image/bmp'],
  'sharp-animation-convertible-image': ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml', 'image/x-icon', 'image/bmp'],
};

export const isMimeImage = (mime: string, type: keyof typeof dictionary): boolean => dictionary[type].includes(mime);

function fixMime(mime: string): string {
  // see https://github.com/misskey-dev/misskey/pull/10686
  if (mime === 'audio/x-flac') {
    return 'audio/flac';
  }
  if (mime === 'audio/vnd.wave') {
    return 'audio/wav';
  }

  return mime;
}
