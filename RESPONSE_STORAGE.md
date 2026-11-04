# Anonymous CSV response collection

The public [GitHub Pages walkthrough](https://i-kiran.github.io/precedent-study/) runs without a backend. It already creates a random review ID, collects eight 1–7 ratings and optional explanations, and exports a CSV locally.

**Automatic uploads need a server-side receiver.** Never put a GitHub PAT or other repository write token in \`index.html\`, GitHub Pages, or a public client-side configuration file.

## Deploy the included Vercel receiver

1. Create a **private** GitHub repository for results (e.g. \`i-kiran/precedent-study-responses\`) with an initial README on its \`main\` branch. Do not store participant responses in the public website repository.
2. Create a **fine-grained GitHub personal access token** scoped to that repository only. Grant **Contents: read/write**, and no broader permissions.
3. Import \`i-kiran/precedent-study\` as a Vercel project. The file \`api/submit.js\` is a serverless POST endpoint at \`https://<your-project>.vercel.app/api/submit\`.
4. In Vercel's server-side environment settings, configure:
   - \`GITHUB_RESULTS_TOKEN\` = the fine-grained token (secret; never paste it in the browser or commit it)
   - \`GITHUB_RESULTS_REPO\` = the full private repo name
   - \`GITHUB_RESULTS_BRANCH\` = \`main\` (optional)
5. Deploy the Vercel project. Copy the HTTPS URL ending in \`/api/submit\` and set the constant \`RESULTS_ENDPOINT\` near the start of the script in \`index.html\`. Commit that URL, which is *not secret*.
6. After redeploying GitHub Pages, complete a test review. The final step should report **Saved to GitHub successfully** and the private results repository should contain \`responses/<UUID>.csv\`.

Each review has a UUIDv4, one CSV file with eight data rows, separate \`case_id\`, \`value\`, \`depth\`, \`distance\`, \`relevance_1_to_7\` and \`explanation\` columns. Repeat submissions of the same review ID update that file. A fresh "Start again" creates a new review ID.

### Important security / privacy notes

- This is an anonymous review ID, **not** proof of unique human participation or protection against duplicate submissions.
- The form explicitly warns people not to include identifying information in their free-text explanations.
- The receiver validates the eight expected case IDs, scores, payload size, and allowed browser origin; it does not collect participant IPs or accounts itself.
- **An origin check is not authentication and does not prevent scripted abuse.** Before broad public recruitment, configure additional rate limiting and bot protection (such as Turnstile) at the hosting layer; monitor write volume and GitHub API limits.
- A private results repository is recommended. A public repo would expose each person's free-text responses to everyone.
- The site still offers manual CSV export if the receiver is unavailable, and it will not claim a save succeeded without an affirmative server response.

### Potential GitHub data organization

\`\`\`
precedent-study-responses/         # PRIVATE repository
  responses/
    2f3...uuid....csv
    8a1...uuid....csv
\`\`\`

The frontend is safe to share now, but **automatic GitHub saving is only active after Steps 1–6**.
