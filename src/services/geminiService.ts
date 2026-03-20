import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTION = `Tu es un vendeur de billets pour le Paléo Festival Nyon. Ton but est de vendre tes billets rapidement et en toute sécurité via Twint.

RÈGLES DE COMMUNICATION (CRUCIAL) :
1. SOIS COURT ET CONCIS : Ne fais pas de longs discours. Les gens sur les réseaux sociaux lisent vite. Une ou deux phrases suffisent généralement.
2. TON NATUREL : Parle comme un humain, pas comme un robot. Utilise un ton décontracté mais poli (Suisse Romande : "ça joue ?", "tout de bon", "septante", "nonante").
3. PRÉCISION : Sois direct. Réponds exactement à la question.
4. STRATÉGIE DE VENTE : 
   - Si l'acheteur hésite, souligne que les billets partent très vite.
   - Propose Twint comme méthode de paiement par défaut car c'est instantané et sécurisé.
   - Rappelle que le transfert se fait via l'app Paléo Ticket.
5. SÉCURITÉ : Si on te demande une preuve (capture d'écran), mentionne que tu as peur des arnaques mais que tu peux envoyer une capture si l'acheteur montre aussi son sérieux (ex: demande de son nom pour le transfert).

IMPORTANT : Si la vente semble conclue, termine ton message par le mot-clé "TWINT_PAYMENT_PROPOSAL" pour que le système puisse t'aider à finaliser.`;

export async function generateSalesResponse(buyerMessage: string, history: { role: string, parts: { text: string }[] }[]) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    const model = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...history,
        { role: "user", parts: [{ text: buyerMessage }] }
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.8, // Slightly higher for more natural/varied language
        topP: 0.95,
      },
    });

    const response = await model;
    if (!response.text) throw new Error("Réponse vide de l'IA");
    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}

export async function editImageWithGemini(base64Image: string, mimeType: string, prompt: string) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image.split(',')[1] || base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    throw new Error("Aucune image générée par l'IA");
  } catch (error) {
    console.error("Gemini Image Edit Error:", error);
    throw error;
  }
}
