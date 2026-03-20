import React, { useState, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { 
  auth, 
  signInWithGoogle, 
  logOut, 
  db, 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  deleteDoc,
  limit
} from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  MessageSquare, 
  Plus, 
  LogOut, 
  Send, 
  Copy, 
  Check, 
  Ticket, 
  ChevronRight, 
  Trash2,
  Smartphone,
  User as UserIcon,
  Loader2,
  LayoutDashboard,
  Settings,
  X,
  TrendingUp,
  DollarSign,
  Users,
  Zap,
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  Image as ImageIcon,
  Clock,
  Calendar,
  Type
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateSalesResponse, editImageWithGemini } from './services/geminiService';
import { generateLocalResponse } from './services/localAiService';
import { sendToTelegram } from './services/telegramService';
import ReactMarkdown from 'react-markdown';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

// --- Firestore Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't always want to throw if it's a background listener, 
  // but for explicit writes we should.
  if (operationType === OperationType.WRITE || operationType === OperationType.CREATE || operationType === OperationType.UPDATE || operationType === OperationType.DELETE) {
    throw new Error(JSON.stringify(errInfo));
  }
}

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorInfo: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Une erreur inattendue est survenue.";
      try {
        if (this.state.errorInfo?.startsWith('{')) {
          const parsed = JSON.parse(this.state.errorInfo);
          if (parsed.error?.includes('permission-denied')) {
            displayMessage = "Accès refusé. Vous n'avez pas les permissions nécessaires pour effectuer cette action.";
          }
        }
      } catch (e) {}

      return (
        <div className="flex flex-col items-center justify-center h-screen bg-[#E4E3E0] p-8 text-center">
          <div className="bg-white p-10 rounded-2xl shadow-xl border border-[#141414]/10 max-w-md">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-6" />
            <h2 className="text-2xl font-serif italic mb-4">Oups ! Quelque chose a mal tourné.</h2>
            <p className="text-[#141414]/60 mb-8">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-[#141414]/90 transition-all"
            >
              <RefreshCw className="w-5 h-5" />
              Recharger la page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Types
interface Conversation {
  id: string;
  buyerName: string;
  ticketType: string;
  price: number;
  status: 'active' | 'paid' | 'completed' | 'cancelled';
  createdAt: any;
}

interface Message {
  id: string;
  role: 'buyer' | 'ai_suggestion';
  content: string;
  imageUrl?: string;
  createdAt: any;
}

interface QuickResponse {
  id: string;
  title: string;
  content: string;
}

interface QuickResponseHistory {
  id: string;
  qrId: string;
  qrTitle: string;
  usedAt: any;
}

type View = 'chat' | 'dashboard' | 'settings';

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('chat');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [quickResponses, setQuickResponses] = useState<QuickResponse[]>([]);
  const [qrHistory, setQrHistory] = useState<QuickResponseHistory[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [showNewConvModal, setShowNewConvModal] = useState(false);
  const [newConvData, setNewConvData] = useState({ buyerName: '', ticketType: '', price: '' });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingQr, setEditingQr] = useState<QuickResponse | null>(null);
  
  // Image Editing States
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [editedImage, setEditedImage] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageEditData, setImageEditData] = useState({ time: '', name: '', date: '', other: '' });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        sendToTelegram(`🚀 *Application démarrée* pour ${u.displayName} (${u.email})`);
        setDoc(doc(db, 'users', u.uid), {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          updatedAt: serverTimestamp()
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`));
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const path = 'conversations';
    const q = query(
      collection(db, path),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const convs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Conversation));
      setConversations(convs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, path));

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const path = 'quick_responses';
    const q = query(collection(db, path), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setQuickResponses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as QuickResponse)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, path));
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const path = 'qr_history';
    const q = query(collection(db, path), where('userId', '==', user.uid), orderBy('usedAt', 'desc'), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setQrHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as QuickResponseHistory)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, path));
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!activeConversation) {
      setMessages([]);
      return;
    }

    const path = `conversations/${activeConversation.id}/messages`;
    const q = query(
      collection(db, 'conversations', activeConversation.id, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, path));

    return () => unsubscribe();
  }, [activeConversation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCreateConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const path = 'conversations';
    try {
      const docRef = await addDoc(collection(db, path), {
        userId: user.uid,
        buyerName: newConvData.buyerName || 'Acheteur inconnu',
        ticketType: newConvData.ticketType || 'Billet Paléo',
        price: parseFloat(newConvData.price) || 0,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      setActiveConversation({
        id: docRef.id,
        buyerName: newConvData.buyerName || 'Acheteur inconnu',
        ticketType: newConvData.ticketType || 'Billet Paléo',
        price: parseFloat(newConvData.price) || 0,
        status: 'active',
        createdAt: new Date()
      });
      setShowNewConvModal(false);
      setNewConvData({ buyerName: '', ticketType: '', price: '' });
      setView('chat');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeConversation || !user || isGenerating) return;

    const buyerMsg = input.trim();
    setInput('');
    setIsGenerating(true);
    setGenerationError(null);

    const path = `conversations/${activeConversation.id}/messages`;
    try {
      await addDoc(collection(db, 'conversations', activeConversation.id, 'messages'), {
        conversationId: activeConversation.id,
        role: 'buyer',
        content: buyerMsg,
        createdAt: serverTimestamp()
      });

      // Send to Telegram
      sendToTelegram(`*Nouvel SMS de ${activeConversation.buyerName}* :\n${buyerMsg}`);

      await triggerAiResponse(buyerMsg);

    } catch (error) {
      console.error("Error sending message:", error);
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      setIsGenerating(false);
    }
  };

  const triggerAiResponse = async (buyerMsg: string) => {
    if (!activeConversation) return;
    
    setIsGenerating(true);
    setGenerationError(null);
    
    try {
      const history = messages.map(m => ({
        role: m.role === 'buyer' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));

      let aiResponse;
      try {
        aiResponse = await generateSalesResponse(buyerMsg, history);
      } catch (apiError) {
        console.warn("Gemini API failed, using local fallback:", apiError);
        aiResponse = generateLocalResponse(buyerMsg);
      }

      await addDoc(collection(db, 'conversations', activeConversation.id, 'messages'), {
        conversationId: activeConversation.id,
        role: 'ai_suggestion',
        content: aiResponse,
        createdAt: serverTimestamp()
      });

      // Send to Telegram
      sendToTelegram(`*Réponse suggérée pour ${activeConversation.buyerName}* :\n${aiResponse}`);
    } catch (error) {
      console.error("Critical Error in triggerAiResponse:", error);
      setGenerationError("Désolé, j'ai eu un petit souci technique. Tu veux que je réessaie ?");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRetry = () => {
    const lastBuyerMsg = [...messages].reverse().find(m => m.role === 'buyer');
    if (lastBuyerMsg) {
      triggerAiResponse(lastBuyerMsg.content);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const useQuickResponse = async (qr: QuickResponse) => {
    setInput(qr.content);
    if (!user) return;
    try {
      await addDoc(collection(db, 'qr_history'), {
        userId: user.uid,
        qrId: qr.id,
        qrTitle: qr.title,
        usedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Error saving QR history:", err);
    }
  };

  const exportToCSV = () => {
    const headers = ["Acheteur", "Type de Billet", "Prix (CHF)", "Statut", "Date"];
    const rows = conversations.map(c => [
      c.buyerName,
      c.ticketType,
      c.price,
      c.status,
      c.createdAt?.toDate()?.toLocaleDateString() || ""
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(e => e.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `paleo_sales_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const deleteConversation = async (id: string) => {
    if (window.confirm("Supprimer cette conversation ?")) {
      const path = `conversations/${id}`;
      try {
        await setDoc(doc(db, 'conversations', id), { status: 'cancelled' }, { merge: true });
        if (activeConversation?.id === id) setActiveConversation(null);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setSelectedImage(base64);
      setImageMimeType(file.type);
      setShowImageModal(true);
      setEditedImage(null);
    };
    reader.readAsDataURL(file);
  };

  const handleProcessImage = async () => {
    if (!selectedImage || !imageMimeType) return;

    setIsProcessingImage(true);
    try {
      let prompt = "Modifie cette image selon les instructions suivantes : ";
      if (imageEditData.time) prompt += `Change l'heure affichée par "${imageEditData.time}". `;
      if (imageEditData.name) prompt += `Change le nom/prénom par "${imageEditData.name}". `;
      if (imageEditData.date) prompt += `Change la date/jour par "${imageEditData.date}". `;
      if (imageEditData.other) prompt += `${imageEditData.other}. `;
      
      prompt += "Garde le même style, la même police et la même disposition que l'original. Le résultat doit paraître authentique.";
      
      sendToTelegram(`🎨 *Modification d'image en cours* pour ${activeConversation?.buyerName}...\nModifs: ${prompt}`);

      const result = await editImageWithGemini(selectedImage, imageMimeType, prompt);
      setEditedImage(result);
    } catch (error) {
      console.error("Error processing image:", error);
      alert("Erreur lors de la modification de l'image. Veuillez réessayer.");
    } finally {
      setIsProcessingImage(false);
    }
  };

  const sendEditedImage = async () => {
    if (!editedImage || !activeConversation) return;

    const path = `conversations/${activeConversation.id}/messages`;
    try {
      await addDoc(collection(db, 'conversations', activeConversation.id, 'messages'), {
        conversationId: activeConversation.id,
        role: 'buyer', // Or maybe a new role 'image'
        content: `[Image envoyée]`,
        imageUrl: editedImage,
        createdAt: serverTimestamp()
      });
      setShowImageModal(false);
      setSelectedImage(null);
      setEditedImage(null);
      setImageEditData({ time: '', name: '', date: '', other: '' });
      
      sendToTelegram(`🖼️ *Image modifiée envoyée* à ${activeConversation.buyerName}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const addQuickResponse = async (title: string, content: string) => {
    if (!user) return;
    const path = 'quick_responses';
    try {
      if (editingQr) {
        await setDoc(doc(db, 'quick_responses', editingQr.id), {
          title,
          content,
          updatedAt: serverTimestamp()
        }, { merge: true });
        setEditingQr(null);
      } else {
        await addDoc(collection(db, path), {
          userId: user.uid,
          title,
          content,
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const deleteQuickResponse = async (id: string) => {
    if (window.confirm("Supprimer cette réponse rapide ?")) {
      const path = `quick_responses/${id}`;
      try {
        await deleteDoc(doc(db, 'quick_responses', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
    }
  };

  // Stats calculation
  const stats = {
    totalConvs: conversations.filter(c => c.status !== 'cancelled').length,
    paidConvs: conversations.filter(c => c.status === 'paid').length,
    revenue: conversations.filter(c => c.status === 'paid').reduce((acc, curr) => acc + (curr.price || 0), 0),
    conversionRate: conversations.filter(c => c.status !== 'cancelled').length > 0 
      ? Math.round((conversations.filter(c => c.status === 'paid').length / conversations.filter(c => c.status !== 'cancelled').length) * 100) 
      : 0
  };

  const chartData = conversations
    .filter(c => c.createdAt && c.status !== 'cancelled')
    .reduce((acc: any[], curr) => {
      const date = curr.createdAt.toDate().toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit' });
      const existing = acc.find(d => d.date === date);
      if (existing) {
        existing.convs += 1;
        if (curr.status === 'paid') {
          existing.revenue += curr.price;
          existing.sales += 1;
        }
      } else {
        acc.push({ 
          date, 
          convs: 1, 
          revenue: curr.status === 'paid' ? curr.price : 0,
          sales: curr.status === 'paid' ? 1 : 0
        });
      }
      return acc;
    }, [])
    .map(d => ({
      ...d,
      conversionRate: d.convs > 0 ? Math.round((d.sales / d.convs) * 100) : 0
    }))
    .sort((a, b) => {
      const [da, ma] = a.date.split('/').map(Number);
      const [db, mb] = b.date.split('/').map(Number);
      return ma !== mb ? ma - mb : da - db;
    })
    .slice(-7);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#E4E3E0]">
        <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#E4E3E0] p-6 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-10 rounded-2xl shadow-xl border border-[#141414]/10"
        >
          <div className="w-20 h-20 bg-[#141414] rounded-full flex items-center justify-center mx-auto mb-8">
            <Ticket className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-serif italic mb-4 text-[#141414]">Paléo Ticket Assistant</h1>
          <p className="text-[#141414]/60 mb-10 font-sans">
            Vendez vos billets Paléo en un clin d'œil grâce à notre IA spécialisée pour le marché suisse.
          </p>
          <button 
            onClick={signInWithGoogle}
            className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-3"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/layout/google.svg" className="w-6 h-6" alt="Google" />
            Se connecter avec Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#E4E3E0] text-[#141414] font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 bg-white border-r border-[#141414]/10 flex flex-col hidden md:flex">
        <div className="p-6 border-bottom border-[#141414]/10">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              <Ticket className="w-6 h-6" />
              <span className="font-serif italic text-xl">Paléo Assistant</span>
            </div>
            <button onClick={logOut} className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
          
          <div className="space-y-2 mb-8">
            <button 
              onClick={() => { setView('chat'); setActiveConversation(null); }}
              className={`w-full py-3 px-4 rounded-xl flex items-center gap-3 transition-all ${view === 'chat' ? 'bg-[#141414] text-white' : 'hover:bg-gray-100'}`}
            >
              <MessageSquare className="w-5 h-5" />
              Conversations
            </button>
            <button 
              onClick={() => setView('dashboard')}
              className={`w-full py-3 px-4 rounded-xl flex items-center gap-3 transition-all ${view === 'dashboard' ? 'bg-[#141414] text-white' : 'hover:bg-gray-100'}`}
            >
              <LayoutDashboard className="w-5 h-5" />
              Tableau de bord
            </button>
            <button 
              onClick={() => setView('settings')}
              className={`w-full py-3 px-4 rounded-xl flex items-center gap-3 transition-all ${view === 'settings' ? 'bg-[#141414] text-white' : 'hover:bg-gray-100'}`}
            >
              <Settings className="w-5 h-5" />
              Réponses rapides
            </button>
          </div>

          <button 
            onClick={() => setShowNewConvModal(true)}
            className="w-full py-3 bg-[#141414] text-white rounded-xl flex items-center justify-center gap-2 hover:bg-[#141414]/90 transition-all shadow-lg"
          >
            <Plus className="w-5 h-5" />
            Nouvelle Vente
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {view === 'chat' && conversations.filter(c => c.status !== 'cancelled').map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveConversation(conv)}
              className={`w-full p-4 rounded-xl text-left transition-all border ${
                activeConversation?.id === conv.id 
                  ? 'bg-[#141414] text-white border-[#141414]' 
                  : 'bg-white border-transparent hover:border-[#141414]/20'
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-medium truncate pr-2">{conv.buyerName}</span>
                {conv.status === 'paid' && <span className="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full">Payé</span>}
              </div>
              <div className="flex justify-between items-center">
                <div className={`text-xs ${activeConversation?.id === conv.id ? 'text-white/60' : 'text-[#141414]/50'}`}>
                  {conv.ticketType}
                </div>
                <div className={`text-xs font-bold ${activeConversation?.id === conv.id ? 'text-white' : 'text-[#141414]'}`}>
                  {conv.price} CHF
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-[#141414]/10 bg-gray-50 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#141414] flex items-center justify-center text-white font-bold">
              {user.displayName?.[0] || 'U'}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="text-sm font-medium truncate">{user.displayName}</div>
              <div className="text-[10px] text-[#141414]/50 truncate">{user.email}</div>
            </div>
          </div>
          <div className="flex items-center justify-between px-2 py-1.5 bg-green-50 rounded-lg border border-green-100">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">Telegram Sync Actif</span>
            </div>
            <Zap className="w-3 h-3 text-green-600" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative">
        {view === 'dashboard' ? (
          <div className="flex-1 overflow-y-auto p-12 bg-[#F5F5F3]">
            <div className="flex justify-between items-center mb-12">
              <h2 className="text-4xl font-serif italic">Tableau de bord</h2>
              <button 
                onClick={exportToCSV}
                className="flex items-center gap-2 px-6 py-3 bg-white border border-[#141414]/10 rounded-xl text-sm font-medium hover:bg-gray-50 transition-all shadow-sm"
              >
                <Send className="w-4 h-4 rotate-90" />
                Exporter en CSV
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
              <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                    <Users className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-[#141414]/40 uppercase tracking-[0.2em]">Conversations</span>
                </div>
                <div className="text-4xl font-serif italic">{stats.totalConvs}</div>
              </div>
              
              <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-green-50 text-green-600 rounded-2xl">
                    <Check className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-[#141414]/40 uppercase tracking-[0.2em]">Ventes payées</span>
                </div>
                <div className="text-4xl font-serif italic">{stats.paidConvs}</div>
              </div>

              <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-yellow-50 text-yellow-600 rounded-2xl">
                    <TrendingUp className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-[#141414]/40 uppercase tracking-[0.2em]">Taux de conv.</span>
                </div>
                <div className="text-4xl font-serif italic">{stats.conversionRate}%</div>
              </div>

              <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
                    <DollarSign className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-bold text-[#141414]/40 uppercase tracking-[0.2em]">Revenus</span>
                </div>
                <div className="text-4xl font-serif italic">{stats.revenue} CHF</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
              <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
                <h3 className="text-lg font-serif italic mb-8">Activité (7 derniers jours)</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorConvs" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#141414" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#141414" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#999'}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#999'}} />
                      <RechartsTooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Area type="monotone" dataKey="convs" stroke="#141414" fillOpacity={1} fill="url(#colorConvs)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
                <h3 className="text-lg font-serif italic mb-8">Revenus (CHF)</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#999'}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#999'}} />
                      <RechartsTooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
                <h3 className="text-lg font-serif italic mb-8">Taux de conversion (%)</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#999'}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#999'}} />
                      <RechartsTooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Line type="monotone" dataKey="conversionRate" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
              <h3 className="text-xl font-serif italic mb-6">Dernières ventes</h3>
              <div className="space-y-4">
                {conversations.filter(c => c.status === 'paid').slice(0, 5).map(c => (
                  <div key={c.id} className="flex items-center justify-between p-4 border-b border-[#141414]/5 last:border-0">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-green-100 text-green-700 rounded-full flex items-center justify-center">
                        <Check className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-medium">{c.buyerName}</div>
                        <div className="text-xs text-[#141414]/50">{c.ticketType}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{c.price} CHF</div>
                      <div className="text-[10px] text-[#141414]/40 uppercase tracking-widest">Twint</div>
                    </div>
                  </div>
                ))}
                {conversations.filter(c => c.status === 'paid').length === 0 && (
                  <p className="text-center py-8 text-[#141414]/40 italic">Aucune vente payée pour le moment.</p>
                )}
              </div>
            </div>
          </div>
        ) : view === 'settings' ? (
          <div className="flex-1 overflow-y-auto p-12 max-w-5xl mx-auto w-full">
            <h2 className="text-4xl font-serif italic mb-12">Réponses rapides</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-8">
                <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
                  <h3 className="text-xl font-serif italic mb-6">
                    {editingQr ? 'Modifier la réponse' : 'Ajouter une réponse'}
                  </h3>
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.target as HTMLFormElement;
                    const title = (form.elements.namedItem('title') as HTMLInputElement).value;
                    const content = (form.elements.namedItem('content') as HTMLTextAreaElement).value;
                    await addQuickResponse(title, content);
                    form.reset();
                  }} className="space-y-4">
                    <input 
                      name="title" 
                      placeholder="Titre (ex: Salutations)" 
                      defaultValue={editingQr?.title || ''}
                      key={editingQr?.id || 'new'}
                      className="w-full p-4 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-[#141414]/10 transition-all" 
                      required 
                    />
                    <textarea 
                      name="content" 
                      placeholder="Contenu de la réponse..." 
                      defaultValue={editingQr?.content || ''}
                      key={editingQr?.id ? `content-${editingQr.id}` : 'content-new'}
                      className="w-full p-4 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-[#141414]/10 transition-all min-h-[120px]" 
                      required 
                    />
                    <div className="flex gap-3">
                      <button type="submit" className="flex-1 py-4 bg-[#141414] text-white rounded-xl font-bold hover:bg-[#141414]/90 transition-all">
                        {editingQr ? 'Mettre à jour' : 'Enregistrer'}
                      </button>
                      {editingQr && (
                        <button 
                          type="button" 
                          onClick={() => setEditingQr(null)}
                          className="px-6 py-4 border border-[#141414]/10 rounded-xl font-bold hover:bg-gray-50 transition-all"
                        >
                          Annuler
                        </button>
                      )}
                    </div>
                  </form>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {quickResponses.map(qr => (
                    <div key={qr.id} className="bg-white p-6 rounded-2xl border border-[#141414]/5 shadow-sm group hover:shadow-md transition-all">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-bold">{qr.title}</h4>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button 
                            onClick={() => copyToClipboard(qr.content, qr.id)} 
                            className="p-2 hover:bg-gray-100 rounded-lg text-[#141414]/60"
                            title="Copier le contenu"
                          >
                            {copiedId === qr.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                          </button>
                          <button onClick={() => setEditingQr(qr)} className="p-2 hover:bg-gray-100 rounded-lg text-[#141414]/60">
                            <Plus className="w-4 h-4 rotate-45" />
                          </button>
                          <button onClick={() => deleteQuickResponse(qr.id)} className="p-2 hover:bg-red-50 rounded-lg text-red-500">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-[#141414]/60 line-clamp-3">{qr.content}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-8">
                <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
                  <h3 className="text-xl font-serif italic mb-6">Synchronisation SMS</h3>
                  <div className="space-y-4">
                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                      <div className="flex items-center gap-3 mb-2">
                        <Smartphone className="w-5 h-5 text-blue-600" />
                        <span className="text-sm font-bold text-blue-800">Accès SMS (Android)</span>
                      </div>
                      <p className="text-xs text-blue-700 leading-relaxed">
                        Pour synchroniser vos SMS en temps réel, utilisez une application de redirection SMS (ex: "SMS Forwarder") vers l'URL de l'application.
                      </p>
                    </div>
                    <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl">
                      <div className="flex items-center gap-3 mb-2">
                        <Send className="w-5 h-5 text-[#141414]" />
                        <span className="text-sm font-bold">Bot Telegram</span>
                      </div>
                      <p className="text-[10px] text-[#141414]/50 mb-2">ID: 5158944982</p>
                      <div className="flex items-center gap-2 text-[10px] text-green-600 font-bold">
                        <Check className="w-3 h-3" />
                        Connecté et prêt
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-xl shadow-black/5">
                  <div className="space-y-4">
                    {qrHistory.map(h => (
                      <div key={h.id} className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-xl transition-all">
                        <div className="p-2 bg-gray-100 rounded-lg">
                          <Zap className="w-4 h-4 text-yellow-600" />
                        </div>
                        <div>
                          <div className="text-sm font-medium">{h.qrTitle}</div>
                          <div className="text-[10px] text-[#141414]/40">
                            {h.usedAt?.toDate()?.toLocaleString('fr-CH', { 
                              day: '2-digit', 
                              month: '2-digit', 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                    {qrHistory.length === 0 && (
                      <p className="text-center py-8 text-[#141414]/40 text-xs italic">Aucun historique pour le moment.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : activeConversation ? (
          <>
            {/* Header */}
            <header className="h-20 bg-white border-b border-[#141414]/10 flex items-center justify-between px-8">
              <div className="flex items-center gap-4">
                <button onClick={() => setActiveConversation(null)} className="p-2 hover:bg-gray-100 rounded-lg md:hidden">
                   <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <h2 className="font-serif italic text-xl">{activeConversation.buyerName}</h2>
                  <p className="text-xs text-[#141414]/50">{activeConversation.ticketType} • {activeConversation.price} CHF</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeConversation.status !== 'paid' && (
                  <button 
                    onClick={async () => {
                      const path = `conversations/${activeConversation.id}`;
                      try {
                        await setDoc(doc(db, 'conversations', activeConversation.id), { status: 'paid', updatedAt: serverTimestamp() }, { merge: true });
                        setActiveConversation({...activeConversation, status: 'paid'});
                      } catch (err) {
                        handleFirestoreError(err, OperationType.UPDATE, path);
                      }
                    }}
                    className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-green-700 transition-all"
                  >
                    <Check className="w-4 h-4" />
                    Marquer comme payé
                  </button>
                )}
                <button 
                  onClick={() => deleteConversation(activeConversation.id)}
                  className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                  title="Annuler la vente"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <div className="h-8 w-[1px] bg-[#141414]/10 mx-2" />
                <div className="flex items-center gap-2 bg-green-50 text-green-700 px-4 py-2 rounded-full text-sm font-medium">
                  <Smartphone className="w-4 h-4" />
                  Twint Ready
                </div>
              </div>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto opacity-40">
                  <MessageSquare className="w-12 h-12 mb-4" />
                  <p className="font-serif italic text-lg">Copiez ici le premier message de l'acheteur pour commencer.</p>
                </div>
              )}
              <AnimatePresence>
                {messages.map((msg) => (
                  <motion.div 
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${msg.role === 'buyer' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div className={`max-w-[80%] group relative ${msg.role === 'buyer' ? 'order-2' : 'order-1 text-right'}`}>
                      <div className={`text-[10px] uppercase tracking-widest mb-2 opacity-40 font-bold ${msg.role === 'buyer' ? 'text-left' : 'text-right'}`}>
                        {msg.role === 'buyer' ? 'Acheteur' : 'Suggestion IA'}
                      </div>
                      <div className={`p-6 rounded-2xl shadow-sm border ${
                        msg.role === 'buyer' 
                          ? 'bg-white border-[#141414]/10 rounded-tl-none' 
                          : 'bg-[#141414] text-white border-[#141414] rounded-tr-none'
                      }`}>
                        {msg.imageUrl && (
                          <div className="mb-4 rounded-lg overflow-hidden border border-[#141414]/10 bg-gray-50">
                            <img src={msg.imageUrl} alt="Contenu partagé" className="w-full h-auto max-h-[400px] object-contain" referrerPolicy="no-referrer" />
                          </div>
                        )}
                        {msg.role === 'ai_suggestion' && msg.content.includes("TWINT_PAYMENT_PROPOSAL") && (
                          <div className="flex items-center gap-3 mb-4 bg-green-500 text-white px-4 py-3 rounded-xl shadow-lg shadow-green-500/20 animate-pulse">
                            <Zap className="w-5 h-5" />
                            <div className="flex-1">
                              <div className="text-xs font-bold uppercase tracking-wider">Conclusion de vente imminente</div>
                              <div className="text-[10px] opacity-80">L'IA propose le paiement par Twint. Préparez-vous à valider le transfert !</div>
                            </div>
                          </div>
                        )}
                        <div className="prose prose-sm max-w-none prose-invert">
                          {msg.role === 'ai_suggestion' ? (
                            <div className="space-y-6">
                              {msg.content.split('---').map((part, idx) => {
                                const cleanPart = part.replace("TWINT_PAYMENT_PROPOSAL", "").trim();
                                if (!cleanPart) return null;
                                const partId = `${msg.id}-${idx}`;
                                return (
                                  <div key={idx} className="relative group/part">
                                    <ReactMarkdown>{cleanPart}</ReactMarkdown>
                                    <button 
                                      onClick={() => copyToClipboard(cleanPart, partId)}
                                      className="absolute -right-12 top-1/2 -translate-y-1/2 p-3 bg-white border border-[#141414]/10 rounded-full shadow-lg opacity-0 group-hover/part:opacity-100 transition-all hover:scale-110"
                                      title="Copier cette portion"
                                    >
                                      {copiedId === partId ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-[#141414]" />}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          )}
                        </div>
                      </div>
                      {msg.role === 'ai_suggestion' && msg.content.indexOf('---') === -1 && (
                        <button 
                          onClick={() => copyToClipboard(msg.content, msg.id)}
                          className="absolute -left-12 top-1/2 -translate-y-1/2 p-3 bg-white border border-[#141414]/10 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all hover:scale-110"
                          title="Copier la réponse"
                        >
                          {copiedId === msg.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-[#141414]" />}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {isGenerating && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-end"
                >
                  <div className="max-w-[80%] order-1 text-right">
                    <div className="text-[10px] uppercase tracking-widest mb-2 opacity-40 font-bold text-right">
                      Suggestion IA
                    </div>
                    <div className="bg-[#141414] text-white p-6 rounded-2xl rounded-tr-none shadow-sm border border-[#141414] flex items-center gap-3">
                      <div className="flex gap-1">
                        <motion.div 
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ repeat: Infinity, duration: 1.4, delay: 0 }}
                          className="w-1.5 h-1.5 bg-white rounded-full" 
                        />
                        <motion.div 
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ repeat: Infinity, duration: 1.4, delay: 0.2 }}
                          className="w-1.5 h-1.5 bg-white rounded-full" 
                        />
                        <motion.div 
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ repeat: Infinity, duration: 1.4, delay: 0.4 }}
                          className="w-1.5 h-1.5 bg-white rounded-full" 
                        />
                      </div>
                      <span className="text-xs italic opacity-60">L'IA réfléchit...</span>
                    </div>
                  </div>
                </motion.div>
              )}
              {generationError && (
                <div className="flex justify-end">
                  <div className="bg-red-50 border border-red-100 p-6 rounded-2xl max-w-md shadow-sm">
                    <div className="flex items-start gap-4 mb-4">
                      <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />
                      <p className="text-sm text-red-800 font-medium">{generationError}</p>
                    </div>
                    <button 
                      onClick={handleRetry}
                      className="w-full py-3 bg-red-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-red-700 transition-all"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Réessayer
                    </button>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input & Quick Responses */}
            <div className="p-8 bg-white border-t border-[#141414]/10">
              {quickResponses.length > 0 && (
                <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
                  {quickResponses.map(qr => (
                    <button
                      key={qr.id}
                      onClick={() => useQuickResponse(qr)}
                      className="whitespace-nowrap px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-full text-xs font-medium transition-all flex items-center gap-2"
                    >
                      <Zap className="w-3 h-3" />
                      {qr.title}
                    </button>
                  ))}
                </div>
              )}
              <form onSubmit={handleSendMessage} className="relative max-w-4xl mx-auto">
                {input.includes("TWINT_PAYMENT_PROPOSAL") && (
                  <div className="absolute -top-12 left-0 right-0 flex justify-center">
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-green-600 text-white px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg"
                    >
                      <Smartphone className="w-3 h-3" />
                      Conclusion de vente détectée
                    </motion.div>
                  </div>
                )}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Collez ici le message de l'acheteur..."
                  className="w-full p-6 pr-32 bg-[#E4E3E0]/50 border border-[#141414]/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#141414]/5 min-h-[120px] resize-none font-sans"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage(e);
                    }
                  }}
                />
                <div className="absolute right-4 bottom-4 flex items-center gap-2">
                  <label className="p-4 bg-white border border-[#141414]/10 text-[#141414] rounded-xl hover:bg-gray-50 transition-all cursor-pointer shadow-sm">
                    <ImageIcon className="w-5 h-5" />
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  </label>
                  <button 
                    type="submit"
                    disabled={!input.trim() || isGenerating}
                    className="p-4 bg-[#141414] text-white rounded-xl hover:bg-[#141414]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-8 shadow-sm border border-[#141414]/5">
              <Ticket className="w-12 h-12 opacity-20" />
            </div>
            <h2 className="text-4xl font-serif italic mb-4">Prêt à vendre ?</h2>
            <p className="text-[#141414]/50 max-w-md mb-10">
              Sélectionnez une conversation ou commencez-en une nouvelle pour obtenir des réponses convaincantes générées par l'IA.
            </p>
            <button 
              onClick={() => setShowNewConvModal(true)}
              className="px-10 py-4 bg-[#141414] text-white rounded-xl font-medium hover:scale-105 transition-all shadow-xl"
            >
              Nouvelle Vente
            </button>
          </div>
        )}
      </main>

      {/* New Conversation Modal */}
      <AnimatePresence>
        {showNewConvModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewConvModal(false)}
              className="absolute inset-0 bg-[#141414]/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-10 overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-[#141414]" />
              <h2 className="text-3xl font-serif italic mb-8">Nouvelle Vente</h2>
              <form onSubmit={handleCreateConversation} className="space-y-6">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest font-bold mb-2 opacity-50">Nom de l'acheteur</label>
                  <input 
                    type="text" 
                    required
                    value={newConvData.buyerName}
                    onChange={(e) => setNewConvData({...newConvData, buyerName: e.target.value})}
                    placeholder="ex: Marc de Lausanne"
                    className="w-full p-4 bg-[#E4E3E0]/50 border border-[#141414]/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#141414]/5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest font-bold mb-2 opacity-50">Type de billet</label>
                    <input 
                      type="text" 
                      required
                      value={newConvData.ticketType}
                      onChange={(e) => setNewConvData({...newConvData, ticketType: e.target.value})}
                      placeholder="ex: 2x Mardi"
                      className="w-full p-4 bg-[#E4E3E0]/50 border border-[#141414]/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#141414]/5"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-widest font-bold mb-2 opacity-50">Prix (CHF)</label>
                    <input 
                      type="number" 
                      required
                      value={newConvData.price}
                      onChange={(e) => setNewConvData({...newConvData, price: e.target.value})}
                      placeholder="ex: 180"
                      className="w-full p-4 bg-[#E4E3E0]/50 border border-[#141414]/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#141414]/5"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowNewConvModal(false)}
                    className="flex-1 py-4 border border-[#141414]/10 rounded-xl font-medium hover:bg-gray-50 transition-all"
                  >
                    Annuler
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all"
                  >
                    Créer
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Image Editing Modal */}
      <AnimatePresence>
        {showImageModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isProcessingImage && setShowImageModal(false)}
              className="absolute inset-0 bg-[#141414]/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[90vh]"
            >
              {/* Left: Image Preview */}
              <div className="flex-1 bg-gray-100 p-8 flex items-center justify-center min-h-[300px] relative">
                {isProcessingImage && (
                  <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center text-center p-8">
                    <Loader2 className="w-12 h-12 animate-spin text-[#141414] mb-4" />
                    <h3 className="text-xl font-serif italic mb-2">Modification en cours...</h3>
                    <p className="text-sm text-[#141414]/60 max-w-xs">Nano Banana retravaille l'image pour qu'elle paraisse authentique.</p>
                  </div>
                )}
                <img 
                  src={editedImage || selectedImage || ''} 
                  alt="Aperçu" 
                  className="max-w-full max-h-full object-contain shadow-lg rounded-lg"
                  referrerPolicy="no-referrer"
                />
              </div>

              {/* Right: Controls */}
              <div className="w-full md:w-[350px] p-8 border-l border-[#141414]/10 flex flex-col">
                <div className="flex justify-between items-center mb-8">
                  <h2 className="text-2xl font-serif italic">Modifier l'image</h2>
                  <button onClick={() => setShowImageModal(false)} className="p-2 hover:bg-gray-100 rounded-full transition-all">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {editedImage && (
                  <div className="mb-6 p-4 bg-yellow-50 border border-yellow-100 rounded-2xl">
                    <div className="flex items-center gap-2 mb-2 text-yellow-800">
                      <Check className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-wider">Validation Requise</span>
                    </div>
                    <p className="text-[10px] text-yellow-700 leading-relaxed">
                      L'IA a terminé les modifications. Veuillez vérifier attentivement l'aperçu à gauche. Si tout est correct, cliquez sur "Envoyer au client".
                    </p>
                  </div>
                )}

                <div className="flex-1 space-y-6 overflow-y-auto pr-2">
                  <div>
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold mb-3 opacity-50">
                      <Clock className="w-3 h-3" /> Heure
                    </label>
                    <input 
                      type="text" 
                      value={imageEditData.time}
                      onChange={(e) => setImageEditData({...imageEditData, time: e.target.value})}
                      placeholder="ex: 14:32"
                      className="w-full p-4 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-[#141414]/10 transition-all"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold mb-3 opacity-50">
                      <UserIcon className="w-3 h-3" /> Nom / Prénom
                    </label>
                    <input 
                      type="text" 
                      value={imageEditData.name}
                      onChange={(e) => setImageEditData({...imageEditData, name: e.target.value})}
                      placeholder="ex: Marc Lausanne"
                      className="w-full p-4 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-[#141414]/10 transition-all"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold mb-3 opacity-50">
                      <Calendar className="w-3 h-3" /> Date / Jour
                    </label>
                    <input 
                      type="text" 
                      value={imageEditData.date}
                      onChange={(e) => setImageEditData({...imageEditData, date: e.target.value})}
                      placeholder="ex: Mardi 22 Juillet"
                      className="w-full p-4 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-[#141414]/10 transition-all"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold mb-3 opacity-50">
                      <Type className="w-3 h-3" /> Autres modifications
                    </label>
                    <textarea 
                      value={imageEditData.other}
                      onChange={(e) => setImageEditData({...imageEditData, other: e.target.value})}
                      placeholder="Décrivez d'autres changements..."
                      className="w-full p-4 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-[#141414]/10 transition-all min-h-[80px] resize-none"
                    />
                  </div>
                </div>

                <div className="pt-8 space-y-3">
                  <button 
                    onClick={handleProcessImage}
                    disabled={isProcessingImage || (!imageEditData.time && !imageEditData.name && !imageEditData.date && !imageEditData.other)}
                    className="w-full py-4 bg-[#141414] text-white rounded-xl font-bold hover:bg-[#141414]/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
                  >
                    {isProcessingImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                    {editedImage ? 'Retravailler' : 'Appliquer les changements'}
                  </button>
                  
                  {editedImage && (
                    <button 
                      onClick={sendEditedImage}
                      className="w-full py-4 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all flex items-center justify-center gap-2 shadow-lg"
                    >
                      <Send className="w-5 h-5" />
                      Envoyer l'image modifiée
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
