import { NextRequest, NextResponse } from 'next/server';
import { getPITagConfigs, savePITagConfig, updatePITagConfig, deletePITagConfig } from '@/lib/queries';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const group = searchParams.get('group') || undefined;
    const tags = getPITagConfigs(group);
    return NextResponse.json({ tags });
  } catch (error) {
    console.error('Error fetching PI tag configs:', error);
    return NextResponse.json({ error: 'Failed to fetch PI tag configs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tag_name, web_id, display_name, tag_group, retrieval_mode, interval, summary_type, unit, y_axis, color, display_order } = body;

    if (!tag_name || !web_id) {
      return NextResponse.json({ error: 'tag_name and web_id are required' }, { status: 400 });
    }

    const saved = savePITagConfig({
      tag_name,
      web_id,
      display_name: display_name || null,
      tag_group: tag_group || 'default',
      retrieval_mode: retrieval_mode || 'summary',
      interval: interval || '1d',
      summary_type: summary_type || 'Average',
      unit: unit || null,
      y_axis: y_axis || 'left',
      color: color || null,
      display_order: display_order || 0,
      is_active: 1,
      decimals: null,
    });

    return NextResponse.json({ tag: saved });
  } catch (error) {
    console.error('Error saving PI tag config:', error);
    return NextResponse.json({ error: 'Failed to save PI tag config' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    updatePITagConfig(id, updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating PI tag config:', error);
    return NextResponse.json({ error: 'Failed to update PI tag config' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    deletePITagConfig(parseInt(id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting PI tag config:', error);
    return NextResponse.json({ error: 'Failed to delete PI tag config' }, { status: 500 });
  }
}
