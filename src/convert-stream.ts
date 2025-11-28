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
            controller.enqueue(buffer);
            buffer = new Uint8Array(0);
            passThrough = true;
            headerValidated = true;
            return;
          }

          controller.enqueue(buffer.subarray(0, 30));
          buffer = buffer.subarray(30);
          _processedBytes += 30;
          headerValidated = true;
        }

        while (buffer.length >= 8) {
          const chunkName = buffer.subarray(0, 4);
          const chunkSize = buffer[4]! + (buffer[5]! << 8) + (buffer[6]! << 16) + (buffer[7]! << 24);
          const totalChunkSize = 8 + chunkSize;

          if (buffer.length < totalChunkSize) {
            // チャンクが不完全なので、次の transform を待つ
            break;
          }

          const chunkData = buffer.subarray(0, totalChunkSize);

          // ANIM chunk
          if (chunkName[0] === 0x41 && chunkName[1] === 0x4e && chunkName[2] === 0x49 && chunkName[3] === 0x4d) {
            // ANIM chunk - set loop count to 1
            // Loop count is at offset 12-13 (relative to chunk start)
            if (chunkData.length >= 14) {
              chunkData[12] = 1;
              chunkData[13] = 0;
            }
            controller.enqueue(chunkData);
          }
          // ANMF chunk
          else if (chunkName[0] === 0x41 && chunkName[1] === 0x4e && chunkName[2] === 0x4d && chunkName[3] === 0x46) {
            // set frame duration to max (0xffffff ms = 4.5 h)
            if (chunkData.length >= 23) {
              chunkData[20] = 0xff;
              chunkData[21] = 0xff;
              chunkData[22] = 0xff;
            }
            controller.enqueue(chunkData);
          }
          // other chunks
          else {
            controller.enqueue(chunkData);
          }

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
          if (buffer.length < 8) {
            // PNG signature is not completely received
            return;
          }

          controller.enqueue(buffer.subarray(0, 8));
          buffer = buffer.subarray(8);
          _processedBytes += 8;
          headerValidated = true;
        }

        // チャンク処理ループ
        while (buffer.length >= 12) {
          const chunkType = buffer.subarray(4, 8);
          const chunkSize = (buffer[0]! << 24) + (buffer[1]! << 16) + (buffer[2]! << 8) + (buffer[3]!);
          const totalChunkSize = 12 + chunkSize;

          if (buffer.length < totalChunkSize) {
            // チャンクが不完全なので、次の transform を待つ
            break;
          }

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

          controller.enqueue(chunkData);
          buffer = buffer.subarray(totalChunkSize);
          _processedBytes += totalChunkSize;
        }
      },
      flush(controller) {
        if (buffer.length > 0) {
          controller.enqueue(buffer);
        }
      },
    });
  }
}

export class ConvertGifToStaticStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor() {
    // https://en.wikipedia.org/wiki/GIF

    let buffer = new Uint8Array(0);
    let _processedBytes = 0;
    let headerProcessed = false;
    let globalColorTableFlag = false;
    let globalColorTableSize = 0;
    let globalColorTableProcessed = false;
    let isCurrentSubBlockNetscape = false;
    let isCurrentSubBlockGce = false;
    let isInMiddleOfSubBlockChain = false;
    let shouldBeDoneAfterCurrentSubBlockChain = false;
    let done = false;

    super({
      start(_controller) {
        // nop
      },
      transform(chunk, controller) {
        if (done) {
          return;
        }

        // 受信チャンクをバッファに追加
        const newBuffer = new Uint8Array(buffer.length + chunk.length);
        newBuffer.set(buffer);
        newBuffer.set(chunk, buffer.length);
        buffer = newBuffer;

        // validate GIF header and Logical Screen Descriptor
        if (!headerProcessed) {
          if (buffer.length < 13) {
            return;
          }

          globalColorTableFlag = (buffer[10]! & 0b10000000) !== 0;
          globalColorTableSize = (2 ** ((buffer[10]! & 0b00000111) + 1)) * 3;

          controller.enqueue(buffer.subarray(0, 13));
          buffer = buffer.subarray(13);
          _processedBytes += 13;
          headerProcessed = true;
        }

        // Global Color Table
        if (!globalColorTableProcessed) {
          if (globalColorTableFlag) {
            if (buffer.length < globalColorTableSize) {
              return;
            }
            controller.enqueue(buffer.subarray(0, globalColorTableSize));
            buffer = buffer.subarray(globalColorTableSize);
            _processedBytes += globalColorTableSize;
          }
          globalColorTableProcessed = true;
        }

        // Blocks
        while (buffer.length > 0) {
          if (isInMiddleOfSubBlockChain) {
            const currentSubBlockSize = buffer[0]!;

            if (isCurrentSubBlockNetscape && currentSubBlockSize === 3 && buffer.length >= 4) {
              buffer[2] = 0x01;
              buffer[3] = 0x00;
              isCurrentSubBlockNetscape = false;
            }
            if (isCurrentSubBlockGce && currentSubBlockSize === 4 && buffer.length >= 5) {
              buffer[2] = 0xff;
              buffer[3] = 0xff;
              isCurrentSubBlockGce = false;
            }

            if (currentSubBlockSize === 0) {
              controller.enqueue(buffer.subarray(0, 1));
              buffer = buffer.subarray(1);
              _processedBytes += 1;

              if (shouldBeDoneAfterCurrentSubBlockChain) {
                // Output trailer (0x3b)
                controller.enqueue(new Uint8Array([0x3b]));
                _processedBytes += 1;
                done = true;
                return;
              }
            }
            else if (buffer.length < currentSubBlockSize + 1) {
              isInMiddleOfSubBlockChain = true;
              return;
            }
            else {
              controller.enqueue(buffer.subarray(0, currentSubBlockSize + 1));
              buffer = buffer.subarray(currentSubBlockSize + 1);
              _processedBytes += currentSubBlockSize + 1;
              continue;
            }
          }

          isInMiddleOfSubBlockChain = false;

          const blockType = buffer[0]!;

          // Extension Block (0x21)
          if (blockType === 0x21) {
            if (buffer.length < 2) {
              return; // Wait for extension type
            }

            const extensionType = buffer[1]!;

            // Application Extension (0xff)
            if (extensionType === 0xff) {
              // 簡単のためにapplication名+サブブロック長まで入っていることを期待する
              if (buffer.length < 15) {
                return;
              }

              controller.enqueue(buffer.subarray(0, 2));
              buffer = buffer.subarray(2);
              _processedBytes += 2;

              // NETSCAPE2.0
              const isNetscape = buffer[1] === 0x4e && buffer[2] === 0x45 && buffer[3] === 0x54
                && buffer[4] === 0x53 && buffer[5] === 0x43 && buffer[6] === 0x41
                && buffer[7] === 0x50 && buffer[8] === 0x45 && buffer[9] === 0x32
                && buffer[10] === 0x2e && buffer[11] === 0x30;

              while (buffer.length > 0) {
                const currentSubBlockSize = buffer[0]!;
                if (isNetscape && currentSubBlockSize === 3 && buffer.length >= 4) {
                  buffer[2] = 0x01;
                  buffer[3] = 0x00;
                }

                if (currentSubBlockSize === 0) {
                  controller.enqueue(buffer.subarray(0, 1));
                  buffer = buffer.subarray(1);
                  _processedBytes += 1;
                  break;
                }
                else if (buffer.length < currentSubBlockSize + 1) {
                  isInMiddleOfSubBlockChain = true; // Incomplete sub-block
                  isCurrentSubBlockNetscape = isNetscape;
                  return;
                }
                else {
                  controller.enqueue(buffer.subarray(0, currentSubBlockSize + 1));
                  buffer = buffer.subarray(currentSubBlockSize + 1);
                  _processedBytes += currentSubBlockSize + 1;
                }
              }
            }
            // Graphic Control Extension (0xf9)
            else if (extensionType === 0xf9) {
              if (buffer.length < 3) {
                return;
              }

              controller.enqueue(buffer.subarray(0, 2));
              buffer = buffer.subarray(2);

              while (buffer.length > 0) {
                const currentSubBlockSize = buffer[0]!;
                if (currentSubBlockSize === 4 && buffer.length >= 5) {
                  buffer[2] = 0xff;
                  buffer[3] = 0xff;
                }

                if (currentSubBlockSize === 0) {
                  controller.enqueue(buffer.subarray(0, 1));
                  buffer = buffer.subarray(1);
                  _processedBytes += 1;
                  break;
                }
                else if (buffer.length < currentSubBlockSize + 1) {
                  isInMiddleOfSubBlockChain = true;
                  isCurrentSubBlockGce = true;
                  return;
                }
                else {
                  controller.enqueue(buffer.subarray(0, currentSubBlockSize + 1));
                  buffer = buffer.subarray(currentSubBlockSize + 1);
                  _processedBytes += currentSubBlockSize + 1;
                }
              }
            }
            // Unknown Extension Blocks
            else {
              controller.enqueue(buffer.subarray(0, 2));
              buffer = buffer.subarray(2);
              _processedBytes += 2;

              while (buffer.length > 0) {
                const currentSubBlockSize = buffer[0]!;

                if (currentSubBlockSize === 0) {
                  controller.enqueue(buffer.subarray(0, 1));
                  buffer = buffer.subarray(1);
                  _processedBytes += 1;
                  break;
                }
                else if (buffer.length < currentSubBlockSize + 1) {
                  isInMiddleOfSubBlockChain = true; // Incomplete sub-block
                  return;
                }
                else {
                  controller.enqueue(buffer.subarray(0, currentSubBlockSize + 1));
                  buffer = buffer.subarray(currentSubBlockSize + 1);
                  _processedBytes += currentSubBlockSize + 1;
                }
              }
            }
          }
          // Image Block (0x2c)
          else if (blockType === 0x2c) {
            if (buffer.length < 12) {
              return;
            }

            const localColorTableFlag = (buffer[9]! & 0b10000000) !== 0;
            const localColorTableSize = (2 ** ((buffer[9]! & 0b00000111) + 1)) * 3;

            if (localColorTableFlag) {
              if (buffer.length < localColorTableSize + 1) {
                return;
              }
              controller.enqueue(buffer.subarray(0, localColorTableSize));
              buffer = buffer.subarray(localColorTableSize);
              _processedBytes += localColorTableSize;
            }

            // 先にLCTのチェックをしたいので順番が逆
            controller.enqueue(buffer.subarray(0, 11));
            buffer = buffer.subarray(11);
            _processedBytes += 11;

            while (buffer.length > 0) {
              const currentSubBlockSize = buffer[0]!;

              if (currentSubBlockSize === 0) {
                controller.enqueue(buffer.subarray(0, 1));
                buffer = buffer.subarray(1);
                _processedBytes += 1;
                break;
              }
              else if (buffer.length < currentSubBlockSize + 1) {
                isInMiddleOfSubBlockChain = true; // Incomplete sub-block
                shouldBeDoneAfterCurrentSubBlockChain = true;
                return;
              }
              else {
                controller.enqueue(buffer.subarray(0, currentSubBlockSize + 1));
                buffer = buffer.subarray(currentSubBlockSize + 1);
                _processedBytes += currentSubBlockSize + 1;
              }
            }

            // Output trailer (0x3b)
            controller.enqueue(new Uint8Array([0x3b]));
            _processedBytes += 1;
            done = true;
            return;
          }
          // Trailer (0x3b)
          else if (blockType === 0x3b) {
            controller.enqueue(buffer.subarray(0, 1));
            buffer = buffer.subarray(1);
            _processedBytes += 1;
            done = true;
            return;
          }
          // Unknown block type
          else {
            // Invalid GIF structure - should not happen in valid GIFs
            // Just output what we have and mark as done
            controller.enqueue(new Uint8Array([0x3b]));
            _processedBytes += 1;
            done = true;
            break;
          }
        }
      },

      flush(controller) {
        if (!done && buffer.length > 0) {
          controller.enqueue(buffer);
        }
      },
    });
  }
}
