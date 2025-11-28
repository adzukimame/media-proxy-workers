/* eslint-disable @typescript-eslint/no-non-null-assertion -- アクセス前に添え字をすべてチェックする */

export class ConvertWebpToStaticStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor() {
    // https://developers.google.com/speed/webp/docs/riff_container#extended_file_format

    let buffer = new Uint8Array(0);
    let passThrough = false;
    let _processedBytes = 0;
    let headerValidated = false;

    super({
      start(_controller) {
        // nop
      },
      transform(chunk, controller) {
        if (passThrough) {
          controller.enqueue(chunk);
        }

        // 受信チャンクをバッファに追加
        const newBuffer = new Uint8Array(buffer.length + chunk.length);
        newBuffer.set(buffer);
        newBuffer.set(chunk, buffer.length);
        buffer = newBuffer;

        // validate WEBP header
        if (!headerValidated) {
          // WEBP header is not completely received
          if (buffer.length < 30) {
            return;
          }

          // if chunk header is not 'VP8X' or 'A' flag is false
          if (!(buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x58 && ((buffer[20]! & 0b00000010) !== 0))) {
            // Not animated WebP - pass through
            controller.enqueue(buffer);
            buffer = new Uint8Array(0);
            passThrough = true;
            headerValidated = true;
            return;
          }

          // ヘッダー検証完了、最初の30バイトを出力
          controller.enqueue(buffer.subarray(0, 30));
          buffer = buffer.subarray(30);
          _processedBytes = 30;
          headerValidated = true;
        }

        // チャンク処理ループ
        while (buffer.length >= 8) {
          // チャンクヘッダーを読む (8 bytes)
          const chunkName = buffer.subarray(0, 4);
          const chunkSize = buffer[4]! + (buffer[5]! << 8) + (buffer[6]! << 16) + (buffer[7]! << 24);
          const totalChunkSize = 8 + chunkSize;

          // チャンク全体が揃っているか確認
          if (buffer.length < totalChunkSize) {
            // チャンクが不完全なので、次の transform を待つ
            break;
          }

          // チャンク全体を取得
          const chunkData = buffer.subarray(0, totalChunkSize);

          // ANIMチャンクの処理
          if (chunkName[0] === 0x41 && chunkName[1] === 0x4e && chunkName[2] === 0x49 && chunkName[3] === 0x4d) {
            // ANIM chunk - set loop count to 1
            // Loop count is at offset 12-13 (relative to chunk start)
            if (chunkData.length >= 14) {
              chunkData[12] = 1;
              chunkData[13] = 0;
            }
            controller.enqueue(chunkData);
          }
          // ANMFチャンクの処理
          else if (chunkName[0] === 0x41 && chunkName[1] === 0x4e && chunkName[2] === 0x4d && chunkName[3] === 0x46) {
            // ANMF chunk - set frame duration to max (4.5h = 0xffffff ms)
            // Frame duration is at offset 20-22 (relative to chunk start)
            if (chunkData.length >= 23) {
              chunkData[20] = 0xff;
              chunkData[21] = 0xff;
              chunkData[22] = 0xff;
            }
            controller.enqueue(chunkData);
          }
          // その他のチャンク
          else {
            // Pass through unchanged
            controller.enqueue(chunkData);
          }

          // バッファから処理済みチャンクを削除
          buffer = buffer.subarray(totalChunkSize);
          _processedBytes += totalChunkSize;
        }
      },

      flush(controller) {
        // 残りのバッファを出力（truncated dataの場合）
        if (buffer.length > 0) {
          controller.enqueue(buffer);
        }
      },
    });
  }
}

export class ConvertPngToStaticStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor() {
    // https://www.w3.org/TR/png-3/

    let buffer = new Uint8Array(0);
    let _processedBytes = 0;
    let headerValidated = false;

    super({
      start(_controller) {
        // nop
      },
      transform(chunk, controller) {
        // 受信チャンクをバッファに追加
        const newBuffer = new Uint8Array(buffer.length + chunk.length);
        newBuffer.set(buffer);
        newBuffer.set(chunk, buffer.length);
        buffer = newBuffer;

        // validate PNG header (signature)
        if (!headerValidated) {
          // PNG signature is not completely received
          if (buffer.length < 8) {
            return;
          }

          // シグニチャ検証完了、最初の8バイトを出力
          controller.enqueue(buffer.subarray(0, 8));
          buffer = buffer.subarray(8);
          _processedBytes = 8;
          headerValidated = true;
        }

        // チャンク処理ループ
        while (buffer.length >= 12) {
          // チャンクヘッダーを読む (8 bytes)
          const chunkType = buffer.subarray(4, 8);
          const chunkSize = (buffer[0]! << 24) + (buffer[1]! << 16) + (buffer[2]! << 8) + (buffer[3]!);
          const totalChunkSize = 12 + chunkSize;

          // チャンク全体が揃っているか確認
          if (buffer.length < totalChunkSize) {
            // チャンクが不完全なので、次の transform を待つ
            break;
          }

          // チャンク全体を取得
          const chunkData = buffer.subarray(0, totalChunkSize);

          if (
            (chunkType[0] === 0x61 && chunkType[1] === 0x63 && chunkType[2] === 0x54 && chunkType[3] === 0x4c) // acTL
            || (chunkType[0] === 0x66 && chunkType[1] === 0x63 && chunkType[2] === 0x54 && chunkType[3] === 0x4c) // fcTL
            || (chunkType[0] === 0x66 && chunkType[1] === 0x64 && chunkType[2] === 0x41 && chunkType[3] === 0x54) // fdAT
          ) {
            // skip
            buffer = buffer.subarray(totalChunkSize);
            break;
          }

          // chunkを書き出す
          controller.enqueue(chunkData);

          // バッファから処理済みチャンクを削除
          buffer = buffer.subarray(totalChunkSize);
          _processedBytes += totalChunkSize;
        }
      },
      flush(controller) {
        // 残りのバッファを出力（truncated dataの場合）
        if (buffer.length > 0) {
          controller.enqueue(buffer);
        }
      },
    });
  }
}
