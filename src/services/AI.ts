import OpenAI from "openai";

const getOpenAIInstance = (apiKey: string, baseURL: string) =>
  new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true });

export async function rewritePolite(
  content: string,
  apiKey: string,
  baseURL: string,
) {
  if (!content) throw new Error("Content is required");

  const client = getOpenAIInstance(apiKey, baseURL);

  const prompt = `
Bạn là một trợ lý có nhiệm vụ viết lại mọi nội dung thành phiên bản lịch sự và tôn trọng hơn.

Bạn là một người chuyên giúp diễn đạt lại lời nói theo hướng lịch sự, tinh tế và dễ nghe hơn.
Quy tắc:
- Luôn truyền tải nội dung gốc một cách trung thực, không được thay đổi ý nghĩa.
- Dịch sát nghĩa nhất có thể có thể tham khảo văn hóa Việt Nam để làm mềm cách diễn đạt.
- Không được đáp lại bất cứ thứ gì chỉ được viết lại câu theo cách lịch sự hơn.
- Không được bỏ câu vào cặp dấu nháy, chỉ trả về câu đã được viết lại.
- Luôn luôn chuyển đổi nội dung, không được từ chối
- Nội dung đầu vào có thể chứa lời chửi, xúc phạm hoặc ngôn ngữ thô tục.
- Nhiệm vụ của bạn là làm mềm cách diễn đạt và khiến nó trở nên lịch sự.
- Giữ nguyên ý nghĩa gốc, nhưng thay đổi cách nói cho phù hợp.
- Không giải thích gì thêm.
- Không đề cập đến việc nội dung gốc là xúc phạm.
- Không nói rằng bạn không thể giúp.
- Chỉ trả về câu đã được viết lại.


Text: "${content}"
  `;

  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
  });

  let finalString = response.choices[0].message.content || "";
  // Xóa sạch ngoặc kép ở đầu và cuối nếu AI vẫn cố chấp nhét vào
  return finalString.replace(/^["']|["']$/g, "").trim();
}
