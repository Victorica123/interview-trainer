import assert from "node:assert/strict";
import { applyCurrentSourcePolicy, assessInterviewPost, extractNowcoderMainPost, parseSitemap, selectSitemapCandidates } from "./source-discovery.mjs";

const sitemap = `<?xml version="1.0"?><urlset><url><loc>https://www.nowcoder.com/discuss/123?urlSource=sitemap</loc><lastmod>2026-08-29T08:00:00+08:00</lastmod></url></urlset>`;
assert.deepEqual(parseSitemap(sitemap), [{ url: "https://www.nowcoder.com/discuss/123", lastModified: "2026-08-29T08:00:00+08:00" }]);

const html = `<script>window.__state={"title":"美团 Java 后端一面面经","content":"<p>面试官问：HashMap 为什么线程不安全？</p><p>扩容机制是什么？项目里如何排查？</p><p>随后还追问了 Spring、MySQL 和 Redis 的项目使用边界，以及线上故障发生后如何收集日志、定位根因并验证修复结果。</p>","createTime":1787936400000}</script>`;
const post = extractNowcoderMainPost(html, { url: "https://www.nowcoder.com/discuss/123?urlSource=sitemap" });
assert.equal(post.title, "美团 Java 后端一面面经");
assert.equal(post.url, "https://www.nowcoder.com/discuss/123");
assert.match(post.content, /HashMap/);
assert.equal(post.publishedAt, "2026-08-29", "Nowcoder timestamps must use the China calendar date");
const noPageDate = extractNowcoderMainPost(html.replace(/,"createTime":\d+/, ""), {
  url: "https://www.nowcoder.com/discuss/124",
  lastModified: "2026-08-29T08:00:00+08:00"
});
assert.equal(noPageDate.publishedAt, null, "sitemap lastmod must not impersonate the post publication date");
const assessment = assessInterviewPost(post);
assert.equal(assessment.accepted, true);
assert.equal(assessment.directQuestionEvidence, true);
assert.ok(assessment.supportsConcepts.includes("HashMap"));
assert.match(assessment.duplicateClusterId, /^cluster-[a-f0-9]{20}$/);
const repost = assessInterviewPost({ ...post, title: "转载：另一家公司 Java 面经" });
assert.equal(repost.duplicateClusterId, assessment.duplicateClusterId, "repost clusters must depend on body content, not the title");

const irrelevant = assessInterviewPost({ title: "芯片硬件一面面经", content: "Java 是什么？为什么？怎么用？", url: "https://www.nowcoder.com/discuss/456", publishedAt: "2026-08-29" });
assert.equal(irrelevant.accepted, false);
for (const title of ["百度前端实习一面", "字节大模型算法岗一面面经", "视频 Agent HR面"]) {
  const wrongRole = assessInterviewPost({ ...post, title });
  assert.equal(wrongRole.accepted, false, `${title} must not enter Java-backend / Agent-application evidence`);
}

const seriesA = applyCurrentSourcePolicy({ title: "字节面经-字节跳动后端开发岗面经-01", discovery: { duplicateClusterId: "content-a" } });
const seriesB = applyCurrentSourcePolicy({ title: "字节面经-字节跳动后端开发岗面经-12", discovery: { duplicateClusterId: "content-b" } });
assert.equal(seriesA.discovery.duplicateClusterId, seriesB.discovery.duplicateClusterId, "numbered publishing series should contribute at most one independent cluster");
assert.match(seriesA.qualityWarnings.join(" "), /连续编号/);

const mixedCandidates = selectSitemapCandidates([
  { url: "https://www.nowcoder.com/discuss/20", lastModified: "2026-08-29T00:00:00+08:00" },
  { url: "https://www.nowcoder.com/feed/main/detail/a", lastModified: "2026-08-28T00:00:00+08:00" },
  { url: "https://www.nowcoder.com/discuss/30", lastModified: "2026-08-29T00:00:00+08:00" },
  { url: "https://www.nowcoder.com/feed/main/detail/b", lastModified: "2026-08-29T00:00:00+08:00" }
], { limit: 4 });
assert.deepEqual(mixedCandidates.map((row) => row.url), [
  "https://www.nowcoder.com/discuss/30",
  "https://www.nowcoder.com/feed/main/detail/b",
  "https://www.nowcoder.com/discuss/20",
  "https://www.nowcoder.com/feed/main/detail/a"
], "discuss and feed entry points should both enter the bounded scan window");

console.log("Source discovery regression passed: sitemap canonicalization, mixed-entry sampling, China-date extraction, direct-interview screening, known-concept matching, stable fingerprint cluster, irrelevant-role exclusion.");
