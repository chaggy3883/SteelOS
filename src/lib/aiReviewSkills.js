import { db } from '@/api/apiClient';

// Standardized handler for the "ai_review_skills" hook: takes a Skill (a stored
// system prompt) plus unstructured file attachments, and produces a report tied
// permanently to a Bid via BidReviewReport. Uses the app's existing UploadFile /
// InvokeLLM integration mocks (see src/api/localData.js) — there is no real
// Claude call wired up here, same "honest stub" disclosure as this app's other
// integration placeholders (GL export, billing webhooks).
export async function runBidReviewSkill(bid, skill, files = []) {
  const fileUrls = [];
  for (const file of files) {
    const { file_url } = await db.integrations.Core.UploadFile({ file });
    fileUrls.push(file_url);
  }

  const report = await db.entities.BidReviewReport.create({
    bid_id: bid.id,
    skill_id: skill.id,
    skill_name: skill.name,
    file_urls: fileUrls,
    status: 'running',
  });

  try {
    const prompt = [
      skill.system_prompt,
      '',
      'Bid context:',
      `Job: ${bid.job_name || 'N/A'}`,
      `Customer: ${bid.customer_name || 'N/A'}`,
      `Scope Summary: ${bid.scope_summary || 'N/A'}`,
      `Inclusions: ${bid.inclusions || 'N/A'}`,
      `Exclusions: ${bid.exclusions || 'N/A'}`,
    ].join('\n');

    const response = await db.integrations.Core.InvokeLLM({ prompt, file_urls: fileUrls });

    return await db.entities.BidReviewReport.update(report.id, {
      status: 'complete',
      report_content: response?.content || '',
      summary: response?.summary || '',
    });
  } catch (e) {
    return db.entities.BidReviewReport.update(report.id, { status: 'failed' });
  }
}
