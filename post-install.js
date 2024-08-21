import * as fs from 'node:fs';

// `node_modules/content-disposition/index.js:22`
// `require` 文を `import` 文に変更
{
  const content = fs.readFileSync('node_modules/content-disposition/index.js');

  fs.writeFileSync(
    'node_modules/content-disposition/index.js',
    content.toString('utf8').replace(
      "var basename = require('path').basename", // eslint-disable-line @stylistic/quotes
      "import { basename } from 'node:path'" // eslint-disable-line @stylistic/quotes
    )
  );
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

// `node_modules/safe-buffer/index.js:3`
// `require` 文を `import` 文に変更
{
  const content = fs.readFileSync('node_modules/safe-buffer/index.js');

  fs.writeFileSync(
    'node_modules/safe-buffer/index.js',
    content.toString('utf8').replace(
      "var buffer = require('buffer')", // eslint-disable-line @stylistic/quotes
      "import * as buffer from 'node:buffer'" // eslint-disable-line @stylistic/quotes
    )
  );
}
