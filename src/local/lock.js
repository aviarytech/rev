import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
// A shared directory lock serializes manual and scheduled reviews. A crashed
// process leaves a lock requiring explicit removal: never risk two reviewers.
export async function withReviewLock(home,work) {
  await mkdir(home,{recursive:true,mode:0o700});
  const lock=join(home,'review.lock');
  try {await mkdir(lock,{mode:0o700});} catch(error) {
    if(error.code==='EEXIST')throw Error('A review is running, or review.lock needs recovery after a crash');
    throw error;
  }
  try {await writeFile(join(lock,'pid'),String(process.pid));return await work();}
  finally {await rm(lock,{recursive:true,force:true});}
}
