import { execFileSync } from 'node:child_process';
import { resolveBuildTarget } from './build-target';
const args = process.argv.slice(2);
if (args.length !== 1 || !['personal', 'contest', 'audit'].includes(args[0])) {
  throw new Error('Build command is locked: no extra edition, mode or output arguments are accepted');
}
resolveBuildTarget(args[0], process.env);
execFileSync('pnpm', ['exec', 'tsc', '-b'], { stdio: 'inherit' });
execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', args[0]], { stdio: 'inherit' });
