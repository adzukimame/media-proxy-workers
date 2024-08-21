export function convertToStatic(file: { mime: string; ext: string | null; filename: string; buffer: ArrayBuffer }):
{
  mime: string;
  ext: string | null;
  filename: string;
  buffer: ArrayBuffer;
} {
  if (file.mime === 'image/webp') {
    return {
      mime: 'image/webp',
      ext: 'webp',
      filename: file.filename,
      buffer: convertWebpToStatic(file.buffer),
    };
  }
  else if (file.mime === 'image/apng') {
    return {
      mime: 'image/apng',
      ext: 'apng',
      filename: file.filename,
      buffer: convertApngToStatic(file.buffer),
    };
  }
  else if (file.mime === 'image/gif') {
    return {
      mime: 'image/gif',
      ext: 'gif',
      filename: file.filename,
      buffer: convertGifToStatic(file.buffer),
    };
  }
  else {
    return file;
  }
}

function convertWebpToStatic(buffer: ArrayBuffer): ArrayBuffer {
  const src = new Uint8Array(buffer);
  const srcLength = src.length;

  // check if it is VP8X and 'A' flag is true
  if (srcLength < 21 || !(src[12] === 0x56 && src[13] === 0x50 && src[14] === 0x38 && src[15] === 0x58 && ((src[20] & 0b00000010) !== 0))) {
    return buffer;
  }

  const dst = new Uint8Array(new ArrayBuffer(src.length));

  let srcIdx = 30;
  let dstIdx = 30;
  let copiedAnmf = false;
  dst.set(src.subarray(0, 30)); // Extended WebP file header

  while (srcIdx < srcLength) {
    const chunkSize = (src[srcIdx + 4]) + (src[srcIdx + 5] << 8) + (src[srcIdx + 6] << 16) + (src[srcIdx + 7] << 24);

    // ANMF
    if (src[srcIdx] === 0x41 && src[srcIdx + 1] === 0x4e && src[srcIdx + 2] === 0x4d && src[srcIdx + 3] === 0x46) {
      // copy only first ANMF chunk
      if (copiedAnmf) {
        srcIdx += 8 + chunkSize;
        continue;
      }
      else {
        copiedAnmf = true;
      }
    }

    dst.set(src.subarray(srcIdx, srcIdx + 8 + chunkSize), dstIdx);

    // ANIM
    if (src[srcIdx] === 0x41 && src[srcIdx + 1] === 0x4e && src[srcIdx + 2] === 0x49 && src[srcIdx + 3] === 0x4d) {
      // set loop count to 1
      dst[dstIdx + 12] = 1;
      dst[dstIdx + 13] = 0;
    }

    srcIdx += 8 + chunkSize;
    dstIdx += 8 + chunkSize;
  }

  const dstRiffChunkSize = dstIdx - 8;
  dst[4] = dstRiffChunkSize;
  dst[5] = dstRiffChunkSize >> 8;
  dst[6] = dstRiffChunkSize >> 16;
  dst[7] = dstRiffChunkSize >> 24;

  return dst.subarray(0, dstIdx);
}

function convertApngToStatic(buffer: ArrayBuffer): ArrayBuffer {
  const src = new Uint8Array(buffer);
  const srcLength = src.length;
  const dst = new Uint8Array(new ArrayBuffer(src.length));

  let srcIdx = 8;
  let dstIdx = 8;
  dst.set(src.subarray(0, 8)); // PNG signature

  while (srcIdx < srcLength) {
    const chunkSize = (src[srcIdx] << 24) + (src[srcIdx + 1] << 16) + (src[srcIdx + 2] << 8) + (src[srcIdx + 3]);

    if (
      (src[srcIdx + 4] === 0x61 && src[srcIdx + 5] === 0x63 && src[srcIdx + 6] === 0x54 && src[srcIdx + 7] === 0x4c) // acTL
      || (src[srcIdx + 4] === 0x66 && src[srcIdx + 5] === 0x63 && src[srcIdx + 6] === 0x54 && src[srcIdx + 7] === 0x4c) // fcTL
      || (src[srcIdx + 4] === 0x66 && src[srcIdx + 5] === 0x64 && src[srcIdx + 6] === 0x41 && src[srcIdx + 7] === 0x54) // fdAT
    ) {
      // skip
      srcIdx += 12 + chunkSize;
      continue;
    }

    dst.set(src.subarray(srcIdx, srcIdx + 12 + chunkSize), dstIdx);

    srcIdx += 12 + chunkSize;
    dstIdx += 12 + chunkSize;
  }

  return dst.subarray(0, dstIdx);
}

function convertGifToStatic(buffer: ArrayBuffer): ArrayBuffer {
  const src = new Uint8Array(buffer);

  const srcLength = src.length;
  const dst = new Uint8Array(new ArrayBuffer(src.length));

  let srcIdx = 13;
  let dstIdx = 13;
  dst.set(src.subarray(0, 13), 0); // just before Global Color Table

  const globalColorTableFlag = (src[10] & 0b10000000) !== 0;
  const globalColorTableSize = 2 ** ((src[10] & 0b00000111) + 1);

  if (globalColorTableFlag) {
    dst.set(src.subarray(srcIdx, srcIdx + globalColorTableSize * 3), dstIdx);
    srcIdx += globalColorTableSize * 3;
    dstIdx += globalColorTableSize * 3;
  }

  let copiedApplicationExtension = false;
  let copiedGraphicControlExtension = false;

  while (srcIdx < srcLength) {
    // Extension Block
    if (src[srcIdx] === 0x21) {
      // Application Extension
      if (src[srcIdx + 1] === 0xff) {
        // NETSCAPE2.0 extension and have not copied such extension
        if (!copiedApplicationExtension && src[srcIdx + 3] === 0x4e && src[srcIdx + 4] === 0x45 && src[srcIdx + 5] === 0x54 && src[srcIdx + 6] === 0x53 && src[srcIdx + 7] === 0x43 && src[srcIdx + 8] === 0x41 && src[srcIdx + 9] === 0x50 && src[srcIdx + 10] === 0x45 && src[srcIdx + 11] === 0x32 && src[srcIdx + 12] === 0x2e && src[srcIdx + 13] === 0x30) {
          // copy
          dst.set(src.subarray(srcIdx, srcIdx + 19), dstIdx);

          // set loop count to 1
          dst[dstIdx + 16] = 1;
          dst[dstIdx + 17] = 0;

          srcIdx += 19;
          dstIdx += 19;

          copiedApplicationExtension = true;
          continue;
        }
      }
      // Graphic Control Extension
      else if (src[srcIdx + 1] === 0xf9) {
        if (!copiedGraphicControlExtension) {
          dst.set(src.subarray(srcIdx, srcIdx + 8), dstIdx);

          // set delay to 0
          dst[dstIdx + 4] = 0;
          dst[dstIdx + 5] = 0;

          srcIdx += 8;
          dstIdx += 8;
          copiedGraphicControlExtension = true;
          continue;
        }
      }
      // Other extension blocks or duplicate extension blocks
      srcIdx += 2;
      while (true) {
        const blockSize = src[srcIdx];
        if (blockSize === 0) {
          srcIdx += 1;
          break;
        }
        else {
          srcIdx += 1 + blockSize;
        }
      }
    }
    // Image Block
    else if (src[srcIdx] === 0x2c) {
      dst.set(src.subarray(srcIdx, srcIdx + 10), dstIdx);

      const localColorTableFlag = (src[srcIdx + 9] & 0b10000000) !== 0;
      const localColorTableSize = 2 ** ((src[srcIdx + 9] & 0b00000111) + 1);

      srcIdx += 10;
      dstIdx += 10;

      if (localColorTableFlag) {
        dst.set(src.subarray(srcIdx, srcIdx + localColorTableSize * 3), dstIdx);
        dstIdx += localColorTableSize * 3;
        srcIdx += localColorTableSize * 3;
      }

      dst[dstIdx] = src[srcIdx]; // Minimum LZW code size
      dstIdx += 1;
      srcIdx += 1;

      while (true) {
        const blockSize = src[srcIdx];
        dst.set(src.subarray(srcIdx, srcIdx + 1 + blockSize), dstIdx);
        if (blockSize === 0) {
          srcIdx += 1;
          dstIdx += 1;
          break;
        }
        else {
          srcIdx += 1 + blockSize;
          dstIdx += 1 + blockSize;
        }
      }

      // Stop operation if Image Block is copied
      dst[dstIdx] = 0x3b; // Trailer
      srcIdx += 1;
      dstIdx += 1;
      break;
    }
    // Trailer
    else if (src[srcIdx] === 0x3b) {
      dst[dstIdx] = 0x3b;
      srcIdx += 1;
      dstIdx += 1;
    }
    // Unknown Block
    else {
      return buffer;
    }
  }

  return dst.subarray(0, dstIdx);
}
