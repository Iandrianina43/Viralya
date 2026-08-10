import type { VideoProviderName } from "@viralya/shared";

// Abstraction commune des moteurs talking-head (HeyGen, Argil, stub).
export interface VideoScene {
  text: string;
  background?: string | null; // hex ou URL (selon moteur)
}

export interface VideoSubmitInput {
  script: string; // texte complet (fallback mono-scène)
  scenes?: VideoScene[]; // multi-scènes (Argil = moments ; HeyGen = concat)
  captions?: boolean; // sous-titres (défaut true)
  avatarId?: string | null; // id avatar du moteur
  voiceId?: string | null; // id voix du moteur (déjà résolu/validé)
}

export interface VideoPollResult {
  status: "processing" | "ready" | "failed";
  videoUrl?: string;
  error?: string;
}

export interface VideoProvider {
  readonly name: VideoProviderName;
  submit(input: VideoSubmitInput): Promise<{ externalId: string }>;
  poll(externalId: string): Promise<VideoPollResult>;
}

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category?: string;
}
export interface AvatarInfo {
  avatar_id: string;
  name: string;
  preview_image_url?: string;
}
