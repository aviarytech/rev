import {posix} from 'node:path';
// Only immutable regular-file objects are read by the caller. Never execute
// imports or follow filesystem symlinks from repository content.
export function dependencyContext(files,read,limit=100) {
  const seen=new Set(files.map(f=>f.path)),queue=files.map(f=>({path:f.path,content:f.after})),context=[],missing=[];
  for(const path of ['package.json','README.md','.github/workflows/ci.yml','.rev/local-review.json','docs/local-review.md']) {
    if(seen.has(path))continue;
    const content=read(path);if(content!==null){seen.add(path);queue.push({path,content});context.push({path,content});}
  }
  for(let i=0;i<queue.length;i++) {
    const file=queue[i];
    if(!/\.[cm]?[jt]sx?$/.test(file.path))continue;
    const imports=[...file.content.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)].map(m=>m[1]);
    for(const spec of imports) {
      const path=posix.normalize(posix.join(posix.dirname(file.path),spec));
      if(path.startsWith('../')||path.startsWith('/')){missing.push(path);continue;}
      if(seen.has(path))continue;seen.add(path);
      const content=read(path);
      if(content===null){missing.push(path);continue;}
      if(context.length>=limit)throw Error('review-context-file-limit');
      const entry={path,content};context.push(entry);queue.push(entry);
    }
  }
  return {files:context,unresolvedImports:[...new Set(missing)]};
}
