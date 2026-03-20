const TELEGRAM_TOKEN = "7350522643:AAGBrHwDL_8wTt2hCNH51LQguzsIvux6DGk";
const CHAT_ID = "5158944982";

export async function sendToTelegram(message: string) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      console.error("Failed to send to Telegram:", await response.text());
    }
  } catch (error) {
    console.error("Telegram Error:", error);
  }
}
