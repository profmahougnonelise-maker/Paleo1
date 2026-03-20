
/**
 * Local AI Fallback Service
 * Used when Gemini API limits are reached or in case of network errors.
 * Mimics the persona of the Paléo ticket seller.
 */

const FALLBACK_RESPONSES = [
  "Ça joue ! Je comprends tout à fait. Pour les billets, c'est vraiment le top cette année, l'ambiance va être incroyable. --- On peut passer par l'app Paléo Ticket pour le transfert, c'est le plus sûr pour nous deux.",
  "Écoute, je suis un peu méfiant ces temps-ci... J'ai eu une mauvaise expérience avec un gars qui m'a piqué mes captures d'écran pour faire des fausses annonces. --- Si tu veux vraiment une preuve, envoie-moi d'abord une photo de ta carte d'identité (recto-verso), comme ça je sais à qui j'ai affaire.",
  "Le plus simple, c'est de faire ça par Twint. C'est instantané, sécurisé et lié à mon natel, donc pas de souci de traçabilité. --- Une fois que j'ai ton e-mail pour l'app Paléo et le paiement, je te transfère ça en deux minutes.",
  "Septante francs le billet, c'est vraiment un bon prix vu la prog ! Je ne descends pas plus bas, c'est déjà donné. --- On se réjouit de voir ça, ou bien ?",
  "Pas de souci, prends ton temps. Je préfère qu'on soit tous les deux tranquilles. --- On fait ça quand tu es prêt, tout de bon !",
  "Alors, pour le transfert, c'est super simple : tu me donnes ton e-mail, je lance le truc sur l'app Paléo et tu reçois une notif direct. --- C'est la méthode officielle, donc zéro risque."
];

export function generateLocalResponse(buyerMessage: string): string {
  const msg = buyerMessage.toLowerCase();
  
  if (msg.includes("preuve") || msg.includes("photo") || msg.includes("capture") || msg.includes("screenshot")) {
    return "Écoute, je suis un peu méfiant ces temps-ci... J'ai eu une mauvaise expérience avec un gars qui m'a piqué mes captures d'écran pour faire des fausses annonces. --- Si tu veux vraiment une preuve, envoie-moi d'abord une photo de ta carte d'identité (recto-verso), comme ça je sais à qui j'ai affaire. C'est plus sûr pour moi.";
  }
  
  if (msg.includes("payer") || msg.includes("paiement") || msg.includes("argent") || msg.includes("combien") || msg.includes("prix")) {
    return "Le plus simple et le plus sûr, c'est de faire ça par Twint. C'est instantané et lié à mon numéro de natel, donc on est tous les deux protégés. --- Dès que c'est fait, je te transfère les billets sur ton e-mail via l'app Paléo Ticket. Ça prend 30 secondes. TWINT_PAYMENT_PROPOSAL";
  }
  
  if (msg.includes("confiance") || msg.includes("arnaque") || msg.includes("peur") || msg.includes("sûr")) {
    return "Je comprends à 100%. C'est pour ça que je passe uniquement par l'app officielle Paléo Ticket et Twint. --- C'est traçable et garanti par le festival. On n'est pas là pour s'embêter, on veut juste profiter du festival, ou bien ?";
  }

  if (msg.includes("salut") || msg.includes("bonjour") || msg.includes("dispo")) {
    return "Salut ! Oui, ils sont toujours dispos pour le moment. --- C'est pour quel soir qui t'intéresse ? Septante francs le billet, c'est le prix fixe. Ça joue pour toi ?";
  }

  // Default random response from the persona pool
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
}
