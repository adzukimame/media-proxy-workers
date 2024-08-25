import * as fs from 'node:fs';

// `node_modules/content-disposition/index.js:22`
// `require` 文を `import` 文に変更
// `node_modules/content-disposition/index.js:23`
// `require` 文を `import` 文に変更
// 標準のBufferを用いる
{
  const content = fs.readFileSync('node_modules/content-disposition/index.js');

  /* eslint-disable @stylistic/quotes */
  fs.writeFileSync(
    'node_modules/content-disposition/index.js',
    content.toString('utf8').replace(
      "var basename = require('path').basename",
      "import { basename } from 'node:path'"
    ).replace(
      "var Buffer = require('safe-buffer').Buffer",
      "import { Buffer } from 'node:buffer'"
    )
  );
  /* eslint-enable @stylistic/quotes */
}

// `node_modules/file-type/browser.js`
// 最後の `export` 文だけを残す
{
  const content = `export {
  fileTypeFromTokenizer,
  fileTypeFromBuffer,
  fileTypeStream,
} from './core.js';\n`;

  fs.writeFileSync('node_modules/file-type/browser.js', content);
}
