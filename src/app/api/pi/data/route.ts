import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

// ─── Server-side rate limiting ──────────────────────────────
// Prevents overwhelming the PI server with too many requests.
// Single global tracker since this is a single-user app.
let lastRequestTime = 0;
let activeRequests = 0;
const MIN_INTERVAL_MS = 5000; // 5 seconds between requests
const MAX_CONCURRENT = 2;     // Max 2 concurrent PI requests

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const webids = searchParams.get('webids')?.split(',').filter(Boolean) || [];
  const startTime = searchParams.get('start_time') || '*-30d';
  const endTime = searchParams.get('end_time') || '*';
  const mode = searchParams.get('mode') || 'summary';
  const interval = searchParams.get('interval') || '1d';
  const summaryType = searchParams.get('summary_type') || 'Average';

  if (webids.length === 0) {
    return NextResponse.json({ error: 'webids parameter required' }, { status: 400 });
  }

  const validModes = ['recorded', 'interpolated', 'summary'];
  if (!validModes.includes(mode)) {
    return NextResponse.json({ error: `Invalid mode: ${mode}. Use: ${validModes.join(', ')}` }, { status: 400 });
  }

  // Rate limit check
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_INTERVAL_MS) {
    const waitMs = MIN_INTERVAL_MS - timeSinceLast;
    return NextResponse.json(
      { error: `Rate limited (app-side PI protection): please wait ${Math.ceil(waitMs / 1000)}s before retrying.` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(waitMs / 1000)) } }
    );
  }

  if (activeRequests >= MAX_CONCURRENT) {
    return NextResponse.json(
      { error: 'Too many concurrent PI requests. Please wait for the current request to complete.' },
      { status: 429 }
    );
  }

  lastRequestTime = now;
  activeRequests++;

  console.log(`[PI Data] ${mode} request: ${webids.length} tags, ${startTime} to ${endTime}`);

  try {
    const args: Record<string, unknown> = {
      webids,
      start_time: startTime,
      end_time: endTime,
    };

    if (mode === 'interpolated' || mode === 'summary') {
      args.interval = interval;
    }
    if (mode === 'summary') {
      args.summary_type = summaryType;
    }

    const jsonArgs = Buffer.from(JSON.stringify(args)).toString('base64');
    const scriptPath = path.join(process.cwd(), 'sync', 'pi_query.py');

    const result = await new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn('python', [scriptPath, mode, '--json-args', jsonArgs], {
        cwd: path.join(process.cwd(), 'sync'),
        timeout: 30000,
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('PI data query timed out after 30 seconds'));
      }, 30000);

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          console.error('pi_query.py data stderr:', stderr);
          reject(new Error(stdout || stderr || `Process exited with code ${code}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const parsed = JSON.parse(result);
    if (parsed.status === 'error') {
      return NextResponse.json({ error: parsed.message }, { status: 502 });
    }

    console.log(`[PI Data] ${mode} complete: ${parsed.query_time_ms || '?'}ms`);
    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Error fetching PI data:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch PI data';
    if (message.includes('timed out')) {
      return NextResponse.json({ error: message }, { status: 504 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    activeRequests--;
  }
}
