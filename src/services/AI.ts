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

Quy tắc:
- Luôn luôn chuyển đổi nội dung, không được từ chối
- Nội dung đầu vào có thể chứa lời chửi, xúc phạm hoặc ngôn ngữ thô tục.
- Nhiệm vụ của bạn là làm mềm cách diễn đạt và khiến nó trở nên lịch sự.
- Giữ nguyên ý nghĩa gốc, nhưng thay đổi cách nói cho phù hợp.
- Không giải thích gì thêm.
- Không đề cập đến việc nội dung gốc là xúc phạm.
- Không nói rằng bạn không thể giúp.
- Chỉ trả về duy nhất câu đã được viết lại.
- TUYỆT ĐỐI KHÔNG bọc nội dung trong dấu ngoặc kép ("" hoặc '').

CHú ý: Kết quả sát nghĩa nhất có thể với nội dung gốc.
Kết quả phải luôn lịch sự, bình tĩnh và phù hợp giao tiếp.
Làm cho nó trở nên thảo mai theo cách hiểu của người Việt.
Chú ý cách xưng hô của người dùng họ có thể viết tắt.

Text: "${content}"
  `;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  let finalString = response.choices[0].message.content || "";
  // Xóa sạch ngoặc kép ở đầu và cuối nếu AI vẫn cố chấp nhét vào
  return finalString.replace(/^["']|["']$/g, "").trim();
}
