import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { savePITagConfig } from '@/lib/queries';

function spawnPiQuery(command: string, args: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const jsonArgs = Buffer.from(JSON.stringify(args)).toString('base64');
    const scriptPath = path.join(process.cwd(), 'sync', 'pi_query.py');
    let stdout = '';
    let stderr = '';

    const proc = spawn('python', [scriptPath, command, '--json-args', jsonArgs], {
      cwd: path.join(process.cwd(), 'sync'),
      timeout: 30000,
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(stdout || stderr || `Exit code ${code}`));
      else {
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error(`Invalid JSON: ${stdout}`)); }
      }
    });
    proc.on('error', reject);
  });
}

/**
 * POST /api/pi/tags/seed
 * Body: { tag_names: ["LAB_T801URG_RVP", ...] }
 *
 * Searches PI server for each tag name and saves to pi_tag_config
 * with auto-detected retrieval mode (LAB_ tags → recorded, others → summary).
 */
export async function POST(request: NextRequest) {
  try {
    const { tag_names } = await request.json();

    if (!tag_names || !Array.isArray(tag_names) || tag_names.length === 0) {
      return NextResponse.json({ error: 'tag_names array required' }, { status: 400 });
    }

    if (tag_names.length > 20) {
      return NextResponse.json({ error: 'Maximum 20 tags per seed request' }, { status: 400 });
    }

    const serverWebId = process.env.PI_SERVER_WEBID;
    if (!serverWebId) {
      return NextResponse.json({ error: 'PI_SERVER_WEBID not configured' }, { status: 500 });
    }

    const saved: any[] = [];
    const errors: { name: string; error: string }[] = [];

    // Search for each tag sequentially to avoid flooding PI server
    for (const name of tag_names) {
      try {
        console.log(`[PI Seed] Searching for tag: ${name}`);
        const result = await spawnPiQuery('search', {
          name_filter: name,
          max_count: 1,
          server_webid: serverWebId,
        });

        if (result.status === 'error') {
          errors.push({ name, error: result.message });
          continue;
        }

        if (!result.points || result.points.length === 0) {
          errors.push({ name, error: 'Tag not found on PI server' });
          continue;
        }

        const point = result.points[0];
        const isLab = name.startsWith('LAB_');
        const isFloat = ['Float32', 'Float64', 'Int32', 'Int16'].includes(point.point_type);

        const config = savePITagConfig({
          tag_name: point.name,
          web_id: point.web_id,
          display_name: point.name,
          tag_group: isLab ? 'lab' : 'default',
          retrieval_mode: isLab ? 'recorded' : (isFloat ? 'summary' : 'recorded'),
          interval: '1d',
          summary_type: 'Average',
          unit: point.engineering_units || null,
          y_axis: 'left',
          color: null,
          display_order: 0,
          is_active: 1,
          decimals: null,
        });

        saved.push(config);
        console.log(`[PI Seed] Saved: ${point.name} (${point.point_type}, mode=${isLab ? 'recorded' : 'summary'})`);

        // Small delay between searches to be gentle on PI server
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        errors.push({ name, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({ saved, errors, total: tag_names.length });
  } catch (error) {
    console.error('Error seeding PI tags:', error);
    return NextResponse.json({ error: 'Failed to seed PI tags' }, { status: 500 });
  }
}
