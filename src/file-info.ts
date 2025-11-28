import { fileTypeFromBuffer, fileTypeStream } from 'file-type';

import { FILE_TYPE_BROWSERSAFE } from './const.js';

const TYPE_OCTET_STREAM = {
  mime: 'application/octet-stream',
  ext: null,
};

export async function detectType(buffer: ArrayBuffer): Promise<{
  mime: string;
  ext: string | null;
}> {
  const fileSize = buffer.byteLength;
  if (fileSize === 0) {
    return TYPE_OCTET_STREAM;
  }

  const type = await fileTypeFromBuffer(buffer);

  if (type) {
    if (!isMimeImage(type.mime, 'safe-file')) {
      return TYPE_OCTET_STREAM;
    }

    return {
      mime: fixMime(type.mime),
      ext: type.ext,
    };
  }

  return TYPE_OCTET_STREAM;
}

export async function detectStreamType(data: ReadableStream | null): Promise<{
  mime: string;
  ext: string | null;
  data: Awaited<ReturnType<typeof fileTypeStream>> | null;
}> {
  if (data === null) {
    return {
      ...TYPE_OCTET_STREAM,
      data: null,
    };
  }

  const streamWithFileType = await fileTypeStream(data, { sampleSize: 4100 });

  if (streamWithFileType.fileType) {
    if (!isMimeImage(streamWithFileType.fileType.mime, 'safe-file')) {
      return {
        ...TYPE_OCTET_STREAM,
        data: streamWithFileType,
      };
    }

    return {
      mime: fixMime(streamWithFileType.fileType.mime),
      ext: streamWithFileType.fileType.ext,
      data: streamWithFileType,
    };
  }

  return {
    ...TYPE_OCTET_STREAM,
    data: streamWithFileType,
  };
}

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
