import { redirect } from 'next/navigation';
// Manager 2.0: legacy client sections are retired from the product. Old links land on the matching new section;
// the layout above already enforces tenant access before this runs.
const MAP: Record<string, string> = { 'ai-presence': 'ia', golden: 'ia', competitors: 'ia', sources: 'ia', prompts: 'ia', reports: 'relatorios' };
export default async function LegacySection({ params }: { params: Promise<{ id: string; section: string }> }) { const { id, section } = await params; redirect(`/clients/${id}/${MAP[section] || 'google'}`); }
