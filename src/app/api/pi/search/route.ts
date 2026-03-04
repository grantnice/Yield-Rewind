import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || '*';
  const maxCount = parseInt(searchParams.get('max_count') || '100');

  try {
    const serverWebId = process.env.PI_SERVER_WEBID || '';
    if (!serverWebId) {
      return NextResponse.json(
        { error: 'PI_SERVER_WEBID not configured' },
        { status: 500 }
      );
    }

    const args = {
      name_filter: query,
      max_count: maxCount,
      server_webid: serverWebId,
    };

    const jsonArgs = Buffer.from(JSON.stringify(args)).toString('base64');
    const scriptPath = path.join(process.cwd(), 'sync', 'pi_query.py');

    const result = await new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn('python', [scriptPath, 'search', '--json-args', jsonArgs], {
        cwd: path.join(process.cwd(), 'sync'),
        timeout: 30000,
      });

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          console.error('pi_query.py search stderr:', stderr);
          reject(new Error(stdout || stderr || `Process exited with code ${code}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on('error', (err) => reject(err));
    });

    const parsed = JSON.parse(result);
    if (parsed.status === 'error') {
      return NextResponse.json({ error: parsed.message }, { status: 502 });
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('Error searching PI tags:', error);
    const message = error instanceof Error ? error.message : 'Failed to search PI tags';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
