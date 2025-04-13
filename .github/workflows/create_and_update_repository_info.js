"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
require("dotenv/config");
const axios_1 = __importDefault(require("axios"));
const openai_1 = require("@langchain/openai");
const prompts_1 = require("@langchain/core/prompts");
const PROMPT_TEMPLATE = `現在のllms.txt、ファイルの差分情報および修正後のファイル内容をもとに、新しいllms.txtを出力してください。

現在のllms.txt:
現在のllms.txtは以下の通りです。現在のllms.txtをベースにして、プルリクエストの情報に基づき、llms.txtを追加更新してください。
\`\`\`
{current_llms_txt}
\`\`\`

ファイルの差分情報:
\`\`\`
{diff_contents}
\`\`\`

レポジトリ情報:
\`\`\`
レポジトリ名: {repository_name}
レポジトリURL: {repository_url}
\`\`\`

修正後のファイル内容:
\`\`\`\`
{file_contents}
\`\`\`\`


llms.txtの出力形式:
以下のように<output>タグ内に必要な情報を記載してください。
現在のllms.txtから差分情報をもとに、現在のレポジトリ構造に情報を修正してください。(修正点は含めずに、現在のレポジトリの情報に焦点を当ててください。)
現在のllms.txtの情報がない場合は新規で作成してください。
出力は修正後のllms.txtの内容全文を出力してください。
<output>
# レポジトリ名[レポジトリURL]

> プロジェクト概要説明
 
プロジェクト詳細説明(500文字以内で記載)

## ファイル一覧
- ファイル名1[ファイルパス1]: ファイル1の概要説明(300文字以内で記載)
- ファイル名2[ファイルパス2]: ファイル2の概要説明(300文字以内で記載)
...
</output>

それではタスクを開始してください。
`;
async function getFileContent(organization, repository, path) {
    // GITHUB_TOKEN を環境変数から取得
    const token = process.env.GH_TOKEN;
    if (!token) {
        throw new Error('GITHUB_TOKEN 環境変数が設定されていません。');
    }
    try {
        const response = await axios_1.default.get(`https://api.github.com/repos/${organization}/${repository}/contents/${path}`, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github+json'
            }
        });
        return response.data;
    }
    catch (error) {
        // console.error('ファイルの内容の取得に失敗しました:', error);
        return null;
    }
}
async function encodingFileContent(content) {
    try {
        return Buffer.from(content.content, content.encoding).toString('utf-8');
    }
    catch (error) {
        console.error('ファイルの内容のエンコードに失敗しました:', error);
        return "";
    }
}
async function modifyLLMsTxt(llm, repository_name, repository_url, file_contents, current_llms_txt, diff) {
    const prompt = new prompts_1.PromptTemplate({
        template: PROMPT_TEMPLATE,
        inputVariables: ['repository_name', 'repository_url', 'file_contents', 'current_llms_txt', 'diff_contents'],
    });
    const chain = prompt.pipe(llm);
    const result = await chain.invoke({
        repository_name: repository_name,
        repository_url: repository_url,
        file_contents: file_contents,
        current_llms_txt: current_llms_txt,
        diff_contents: diff,
    });
    const result_str = result.content;
    const result_match = result_str.match(/<output>\n*([\s\S]*?)\n*<\/output>/);
    if (result_match) {
        return result_match[1];
    }
    else {
        return result_str;
    }
}
async function getLatestCommitSha(organization, repository, branch) {
    // 環境変数からトークンを取得
    const token = process.env.GH_TOKEN;
    if (!token) {
        throw new Error('GH_TOKEN 環境変数が設定されていません。');
    }
    try {
        const response = await axios_1.default.get(`https://api.github.com/repos/${organization}/${repository}/git/ref/heads/${branch}`, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github+json'
            }
        });
        return response.data.object.sha;
    }
    catch (error) {
        console.error('An error occurred:', error.response?.data || error.message);
        throw error;
    }
}
async function createBranch(organization, repository, newBranch, sha) {
    // 環境変数からトークンを取得
    const token = process.env.GH_TOKEN;
    if (!token) {
        throw new Error('GH_TOKEN 環境変数が設定されていません。');
    }
    try {
        await axios_1.default.post(`https://api.github.com/repos/${organization}/${repository}/git/refs`, {
            ref: `refs/heads/${newBranch}`,
            sha,
        }, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github+json'
            }
        });
    }
    catch (error) {
        console.error('An error occurred:', error.response?.data || error.message);
        throw error;
    }
}
async function updateFile(organization, repository, branch, filePath, content, message) {
    // 環境変数からトークンを取得
    const token = process.env.GH_TOKEN;
    if (!token) {
        throw new Error('GH_TOKEN 環境変数が設定されていません。');
    }
    try {
        const base64Content = Buffer.from(content).toString('base64');
        // 既存ファイルの情報を取得
        let sha = '';
        try {
            const response = await axios_1.default.get(`https://api.github.com/repos/${organization}/${repository}/contents/${filePath}?ref=${branch}`, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github+json'
                }
            });
            sha = response.data.sha;
        }
        catch (error) {
            // ファイルが存在しない場合は新規作成するのでエラーを無視
            if (error.response?.status !== 404) {
                throw error;
            }
        }
        // ファイルを作成または更新
        const payload = {
            message,
            content: base64Content,
            branch
        };
        // 既存ファイルの場合はshaを追加
        if (sha) {
            payload.sha = sha;
        }
        await axios_1.default.put(`https://api.github.com/repos/${organization}/${repository}/contents/${filePath}`, payload, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github+json'
            }
        });
    }
    catch (error) {
        console.error('ファイルの更新に失敗しました:', error.response?.data || error.message);
        throw error;
    }
}
async function createPullRequest(organization, repository, title, body, head, base) {
    // 環境変数からトークンを取得
    const token = process.env.GH_TOKEN;
    if (!token) {
        throw new Error('GH_TOKEN 環境変数が設定されていません。');
    }
    try {
        await axios_1.default.post(`https://api.github.com/repos/${organization}/${repository}/pulls`, {
            title,
            body,
            head,
            base,
        }, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github+json'
            }
        });
    }
    catch (error) {
        console.error('An error occurred:', error.response?.data || error.message);
        throw error;
    }
}
async function pushLLMsTxt(organization, repository, repository_url, push_repository, base_branch, diff, llm) {
    // GITHUB_TOKEN を環境変数から取得
    const token = process.env.GH_TOKEN;
    if (!token) {
        throw new Error('GH_TOKEN 環境変数が設定されていません。');
    }
    try {
        const modify_file_match = diff.matchAll(/diff --git a\/(.*) b\/(.*)/g);
        let file_contents = "";
        for (const match of Array.from(modify_file_match)) {
            const new_file = match[2];
            if (new_file.startsWith(".github")) {
                continue;
            }
            const file_content = await getFileContent(organization, repository, new_file);
            if (file_content) {
                const file_content_str = await encodingFileContent(file_content);
                file_contents += (`ファイル名: ${file_content.name}\n`
                    + `ファイルパス: ${file_content.path}\n`
                    + `ファイル内容: \n\`\`\`\n${file_content_str}\n\`\`\`\n`
                    + `\n`);
            }
            console.log(file_contents);
            console.log("--------------------------------");
        }
        // llms.txtを取得
        const llms_txt_content = await getFileContent(organization, push_repository, `${repository}/llms.txt`);
        const llms_txt_str = await encodingFileContent(llms_txt_content);
        console.log(llms_txt_str);
        console.log("--------------------------------");
        // llms.txtを更新
        const updated_llms_txt = await modifyLLMsTxt(llm, repository, repository_url, file_contents, llms_txt_str, diff);
        console.log(updated_llms_txt);
        console.log("--------------------------------");
        // llms.txtをプッシュ
        // ベースブランチの最新コミットSHAを取得
        const baseSha = await getLatestCommitSha(organization, push_repository, base_branch);
        console.log(`baseSha: ${baseSha}`);
        // 新しいブランチを作成
        const now = new Date();
        const formattedDate = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
        const newBranch = `llms-txt-${formattedDate}`;
        await createBranch(organization, push_repository, newBranch, baseSha);
        console.log(`newBranch: ${newBranch}`);
        // llms.txtをプッシュ
        const filePath = `${repository}/llms.txt`;
        const commitMessage = `Update llms.txt`;
        await updateFile(organization, push_repository, newBranch, filePath, updated_llms_txt, commitMessage);
        console.log(`filePath: ${filePath}`);
        // プルリクエストを作成
        const prTitle = `Update llms.txt`;
        const prBody = `Update llms.txt`;
        await createPullRequest(organization, push_repository, prTitle, prBody, newBranch, base_branch);
        console.log(`PR_TITLE: ${prTitle}`);
        console.log('Pull request created successfully.');
    }
    catch (error) {
        console.error('ファイルの内容の取得に失敗しました:', error);
    }
}
async function main(organizationName, repositoryName, repositoryUrl, pushRepositoryName, baseBranch, diff, apiKey, modelName) {
    const llm = new openai_1.ChatOpenAI({
        apiKey: apiKey,
        model: modelName,
    });
    await pushLLMsTxt(organizationName, repositoryName, repositoryUrl, pushRepositoryName, baseBranch, diff, llm);
}
