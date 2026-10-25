import {defineNitroConfig} from 'nitro/config';
export default defineNitroConfig({
 modules:['workflow/nitro'],
 preset:'vercel',
 vercel:{entryFormat:'node',functions:{maxDuration:300}},
 routes:{'/**':{handler:'./server/app.js',format:'node'}},
 publicAssets:[{dir:'public',maxAge:0}],
 externals:{traceInclude:['node_modules/@fontsource/noto-sans/files/*','node_modules/@fontsource/noto-serif/files/*']},
});
