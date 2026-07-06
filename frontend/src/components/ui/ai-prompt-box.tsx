import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  ArrowUp,
  Paperclip,
  Square,
  X,
  StopCircle,
  Mic,
  Globe,
  BrainCog,
  Loader2,
  FileText,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import parseFileToText from "../../Workspace/utils/parseFileToText.util";
import AttachmentManager from "./AttachmentManager";

import { useUploadedFiles, type UploadedFileMeta } from "../../Workspace/contexts/upload_files.context";


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  input_text: string;
  attached_files: {
    file_id: string;
    file_title: string;
    text_content: string;
  }[];
  options: {
    webSearch: boolean;
    thinking: boolean;
  };
}

export type AttachmentParseStatus = "parsing" | "ready" | "error";

/**
 * All attachment metadata + parse state in one place.
 * Replaces the previous triple of parsedTexts / parseErrors / parsingIds Maps.
 */
export type SelectedAttachment = {
  id: string;
  file_name: string;
  size: number;
  parse_status: AttachmentParseStatus;
  text_content: string | null;
  error: string | null;
};


// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

const cn = (...classes: (string | undefined | null | false)[]) =>
  classes.filter(Boolean).join(" ");


// ─────────────────────────────────────────────────────────────────────────────
// Textarea
// ─────────────────────────────────────────────────────────────────────────────

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex w-full rounded-md border-none bg-transparent px-3 py-2.5 text-base text-gray-100 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px] resize-none scrollbar-thin scrollbar-thumb-[#444444] scrollbar-track-transparent hover:scrollbar-thumb-[#555555]",
        className
      )}
      ref={ref}
      rows={1}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";


// ─────────────────────────────────────────────────────────────────────────────
// Tooltip
// ─────────────────────────────────────────────────────────────────────────────

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border border-[#333333] bg-[#1F2023] px-3 py-1.5 text-sm text-white shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;


// ─────────────────────────────────────────────────────────────────────────────
// Button
// ─────────────────────────────────────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variantClasses = {
      default: "bg-white hover:bg-white/80 text-black",
      outline: "border border-[#444444] bg-transparent hover:bg-[#3A3A40]",
      ghost: "bg-transparent hover:bg-[#3A3A40]",
    };
    const sizeClasses = {
      default: "h-10 px-4 py-2",
      sm: "h-8 px-3 text-sm",
      lg: "h-12 px-6",
      icon: "h-8 w-8 rounded-full aspect-[1/1]",
    };
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";


// ─────────────────────────────────────────────────────────────────────────────
// VoiceRecorder (untouched)
// ─────────────────────────────────────────────────────────────────────────────

interface VoiceRecorderProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: (duration: number) => void;
  visualizerBars?: number;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  visualizerBars = 32,
}) => {
  const [time, setTime] = React.useState(0);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    if (isRecording) {
      onStartRecording();
      timerRef.current = setInterval(() => setTime((t) => t + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      onStopRecording(time);
      setTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center w-full transition-all duration-300 py-3",
        isRecording ? "opacity-100" : "opacity-0 h-0"
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="font-mono text-sm text-white/80">{formatTime(time)}</span>
      </div>
      <div className="w-full h-10 flex items-center justify-center gap-0.5 px-4">
        {[...Array(visualizerBars)].map((_, i) => (
          <div
            key={i}
            className="w-0.5 rounded-full bg-white/50 animate-pulse"
            style={{
              height: `${Math.max(15, Math.random() * 100)}%`,
              animationDelay: `${i * 0.05}s`,
              animationDuration: `${0.5 + Math.random() * 0.5}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// PromptInput context + primitives
// ─────────────────────────────────────────────────────────────────────────────

interface PromptInputContextType {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
}

const PromptInputContext = React.createContext<PromptInputContextType>({
  isLoading: false,
  value: "",
  setValue: () => { },
  maxHeight: 240,
  onSubmit: undefined,
  disabled: false,
});

function usePromptInput() {
  const context = React.useContext(PromptInputContext);
  if (!context) throw new Error("usePromptInput must be used within a PromptInput");
  return context;
}

interface PromptInputProps {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  (
    {
      className,
      isLoading = false,
      maxHeight = 240,
      value,
      onValueChange,
      onSubmit,
      children,
      disabled = false,
    },
    ref
  ) => {
    const [internalValue, setInternalValue] = React.useState(value || "");
    const handleChange = (newValue: string) => {
      setInternalValue(newValue);
      onValueChange?.(newValue);
    };
    return (
      <TooltipProvider>
        <PromptInputContext.Provider
          value={{
            isLoading,
            value: value ?? internalValue,
            setValue: onValueChange ?? handleChange,
            maxHeight,
            onSubmit,
            disabled,
          }}
        >
          <div
            ref={ref}
            className={cn(
              "rounded-3xl border border-[#444444] bg-[#1F2023] p-2 shadow-[0_8px_30px_rgba(0,0,0,0.24)] transition-all duration-300",
              isLoading && "border-red-500/70",
              className
            )}
          >
            {children}
          </div>
        </PromptInputContext.Provider>
      </TooltipProvider>
    );
  }
);
PromptInput.displayName = "PromptInput";

interface PromptInputTextareaProps {
  disableAutosize?: boolean;
  placeholder?: string;
}

const PromptInputTextarea: React.FC<
  PromptInputTextareaProps & React.ComponentProps<typeof Textarea>
> = ({ className, onKeyDown, disableAutosize = false, placeholder, ...props }) => {
  const { value, setValue, maxHeight, onSubmit, disabled } = usePromptInput();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (disableAutosize || !textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height =
      typeof maxHeight === "number"
        ? `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
        : `min(${textareaRef.current.scrollHeight}px, ${maxHeight})`;
  }, [value, maxHeight, disableAutosize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
    onKeyDown?.(e);
  };

  return (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn("text-base", className)}
      disabled={disabled}
      placeholder={placeholder}
      {...props}
    />
  );
};

const PromptInputActions: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className,
  ...props
}) => (
  <div className={cn("flex items-center gap-2", className)} {...props}>
    {children}
  </div>
);

interface PromptInputActionProps extends React.ComponentProps<typeof Tooltip> {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

const PromptInputAction: React.FC<PromptInputActionProps> = ({
  tooltip,
  children,
  side = "top",
  ...props
}) => {
  const { disabled } = usePromptInput();
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild disabled={disabled}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// CustomDivider
// ─────────────────────────────────────────────────────────────────────────────

const CustomDivider: React.FC = () => (
  <div className="relative h-6 w-[1.5px] mx-1">
    <div
      className="absolute inset-0 bg-linear-to-t from-transparent via-[#9b87f5]/70 to-transparent rounded-full"
      style={{
        clipPath:
          "polygon(0% 0%, 100% 0%, 100% 40%, 140% 50%, 100% 60%, 100% 100%, 0% 100%, 0% 60%, -40% 50%, 0% 40%)",
      }}
    />
  </div>
);


// ─────────────────────────────────────────────────────────────────────────────
// PromptInputBox
// ─────────────────────────────────────────────────────────────────────────────

interface PromptInputBoxProps {
  onSend?: (message: ChatMessage) => void;
  isLoading?: boolean;
  placeholder?: string;
  /**
   * Maximum number of files that can be attached at once.
   * Defaults to 5. AttachmentManager will block selection beyond this limit
   * and show an inline error to the user.
   */
  maxAttachments?: number;
}

export const PromptInputBox = React.forwardRef(
  (props: PromptInputBoxProps, ref: React.Ref<HTMLDivElement>) => {
    const {
      onSend = () => { },
      isLoading = false,
      placeholder = "Type your message here...",
      maxAttachments = 5,
    } = props;

    // ── Attachment state ──────────────────────────────────────────────────
    // Single source of truth: parse_status, text_content and error all live
    // here instead of in separate Map/Set states.
    const [selectedAttachments, setSelectedAttachments] = React.useState<SelectedAttachment[]>([]);

    const { getFile } = useUploadedFiles();

    // ── UI state ──────────────────────────────────────────────────────────
    const [input, setInput] = React.useState("");
    const [isRecording, setIsRecording] = React.useState(false);
    const [showSearch, setShowSearch] = React.useState(false);
    const [showThink, setShowThink] = React.useState(false);
    const [showPicker, setShowPicker] = React.useState(false);

    const promptBoxRef = React.useRef<HTMLDivElement>(null);


    // ── Toggle search / think ─────────────────────────────────────────────
    const handleToggleMode = (mode: "search" | "think") => {
      if (mode === "search") {
        setShowSearch((prev) => !prev);
        setShowThink(false);
      } else {
        setShowThink((prev) => !prev);
        setShowSearch(false);
      }
    };


    // ── toggleFileSelectionForAttachment ──────────────────────────────────
    // Called both from AttachmentManager (to select/deselect) and from the
    // chip's ✕ button (to remove). If the file is already selected it gets
    // removed; otherwise it is added with parse_status "parsing" and parsing
    // begins immediately.
    const toggleFileSelectionForAttachment = React.useCallback(
      (file: UploadedFileMeta) => {
        setSelectedAttachments((prev) => {
          const alreadySelected = prev.some((a) => a.id === file.id);

          if (alreadySelected) {
            // Deselect — drop from list
            return prev.filter((a) => a.id !== file.id);
          }

          // Select — add with "parsing" status; parseFileToText runs below
          const newEntry: SelectedAttachment = {
            id: file.id,
            file_name: file.name,
            size: file.size,
            parse_status: "parsing",
            text_content: null,
            error: null,
          };
          return [...prev, newEntry];
        });
      },
      []
    );


    // ── Parse newly-added attachments ─────────────────────────────────────
    // Watches selectedAttachments; any entry whose parse_status is "parsing"
    // and that has not yet started (no ongoing promise tracked) gets kicked off.
    // We track in-flight parses with a ref so the effect doesn't re-fire.
    const inFlightRef = React.useRef<Set<string>>(new Set());

    React.useEffect(() => {
      const parsingEntries = selectedAttachments.filter(
        (a) => a.parse_status === "parsing" && !inFlightRef.current.has(a.id)
      );

      for (const entry of parsingEntries) {
        inFlightRef.current.add(entry.id);

        (async () => {
          try {
            const uploadedFile = await getFile(entry.id);
            if (!uploadedFile) throw new Error("File not found in upload context");
            const text = await parseFileToText(uploadedFile.file as File);

            setSelectedAttachments((prev) =>
              prev.map((a) =>
                a.id === entry.id
                  ? { ...a, parse_status: "ready", text_content: text, error: null }
                  : a
              )
            );
          } catch (err: any) {
            setSelectedAttachments((prev) =>
              prev.map((a) =>
                a.id === entry.id
                  ? {
                    ...a,
                    parse_status: "error",
                    text_content: null,
                    error: err?.message ?? "Parsing failed",
                  }
                  : a
              )
            );
          } finally {
            inFlightRef.current.delete(entry.id);
          }
        })();
      }
    }, [selectedAttachments, getFile]);


    // ── Derived send eligibility ──────────────────────────────────────────
    const hasText = input.trim() !== "";
    const anyParsing = selectedAttachments.some((a) => a.parse_status === "parsing");
    const allAttachmentsReady =
      selectedAttachments.length === 0 ||
      selectedAttachments.every((a) => a.parse_status === "ready");

    const canSend =
      (hasText || selectedAttachments.length > 0) &&
      !isLoading &&
      !isRecording &&
      !anyParsing &&
      allAttachmentsReady;

    const hasContent = hasText || selectedAttachments.length > 0;


    // ── Submit ────────────────────────────────────────────────────────────
    const handleSubmit = () => {
      if (!canSend) return;

      let prefix = "";
      if (showSearch) prefix = "[Search: ";
      else if (showThink) prefix = "[Think: ";
      const formattedInput = prefix ? `${prefix}${input}]` : input;

      const message: ChatMessage = {
        input_text: formattedInput,
        attached_files: selectedAttachments
          .filter((a) => a.parse_status === "ready" && a.text_content !== null)
          .map((a) => ({
            file_id: a.id,
            file_title: a.file_name,          // ✅ was incorrectly `f.name`
            text_content: a.text_content!,
          })),
        options: {
          webSearch: showSearch,
          thinking: showThink,
        },
      };

      onSend(message);
      setInput("");
      setSelectedAttachments([]);
      setShowSearch(false);
      setShowThink(false);
    };


    // ── Voice ─────────────────────────────────────────────────────────────
    const handleStartRecording = () => console.log("Started recording");
    const handleStopRecording = (duration: number) => {
      setIsRecording(false);
      onSend({
        input_text: `[Voice message - ${duration} seconds]`,
        attached_files: [],
        options: { webSearch: false, thinking: false },
      });
    };


    // ── Send button tooltip ───────────────────────────────────────────────
    const sendTooltip = isLoading
      ? "Stop generation"
      : isRecording
        ? "Stop recording"
        : anyParsing
          ? "Parsing attachments…"
          : canSend
            ? "Send message"
            : "Voice message";


    // ── Chips ─────────────────────────────────────────────────────────────
    const renderChips = () => {
      if (selectedAttachments.length === 0) return null;
      return (
        <div className="flex flex-wrap gap-2 px-1 pb-2">
          {selectedAttachments.map((file) => {
            const isParsing = file.parse_status === "parsing";
            const hasError = file.parse_status === "error";
            const isReady = file.parse_status === "ready";

            return (
              <div
                key={file.id}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-sm border",
                  hasError
                    ? "bg-red-500/10 border-red-500/40 text-red-300"
                    : isReady
                      ? "bg-[#2E3033] border-[#444] text-gray-200"
                      : "bg-[#2E3033] border-[#444] text-gray-400"
                )}
              >
                {isParsing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 shrink-0" />
                ) : (
                  <FileText
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      hasError
                        ? "text-red-400"
                        : isReady
                          ? "text-gray-300"
                          : "text-gray-500"
                    )}
                  />
                )}

                <span className="max-w-[140px] truncate">{file.file_name}</span>

                <span
                  className={cn(
                    "text-xs shrink-0",
                    hasError ? "text-red-400" : "text-gray-500"
                  )}
                >
                  {hasError ? "Parse failed" : isParsing ? "Parsing…" : "Ready"}
                </span>

                {/* Clicking ✕ deselects via the same toggle function */}
                <button
                  type="button"
                  onClick={() => toggleFileSelectionForAttachment({ id: file.id, name: file.file_name, size: file.size } as UploadedFileMeta)}
                  className="ml-0.5 hover:text-white transition-colors shrink-0"
                  aria-label={`Remove ${file.file_name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      );
    };


    // ── Render ────────────────────────────────────────────────────────────
    return (
      <PromptInput
        value={input}
        onValueChange={setInput}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        className={cn(
          "w-full bg-[#1F2023] border-[#444444] shadow-[0_8px_30px_rgba(0,0,0,0.24)] transition-all duration-300 ease-in-out",
          isRecording && "border-red-500/70"
        )}
        disabled={isLoading || isRecording}
        ref={ref || promptBoxRef}
      >
        {/* Attachment chips */}
        {!isRecording && renderChips()}

        {/* Textarea */}
        <div
          className={cn(
            "transition-all duration-300",
            isRecording ? "h-0 overflow-hidden opacity-0" : "opacity-100"
          )}
        >
          <PromptInputTextarea
            placeholder={
              showSearch
                ? "Search the web during task planning..."
                : showThink
                  ? "Think deeply..."
                  : placeholder
            }
            className="text-base"
          />
        </div>

        {/* Voice recorder */}
        {isRecording && (
          <VoiceRecorder
            isRecording={isRecording}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
          />
        )}

        <PromptInputActions className="flex items-center justify-between gap-2 p-0 pt-2">
          {/* ── Left actions ── */}
          <div
            className={cn(
              "flex items-center gap-1 transition-opacity duration-300",
              isRecording ? "opacity-0 invisible h-0" : "opacity-100 visible"
            )}
          >
            {/* Paperclip → AttachmentManager popover */}
            <div className="relative">
              <PromptInputAction tooltip="Attach files">
                <button
                  type="button"
                  onClick={() => setShowPicker((prev) => !prev)}
                  className="flex h-8 w-8 text-[#9CA3AF] cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-gray-600/30 hover:text-[#D1D5DB]"
                  disabled={isRecording}
                  aria-label="Attach files"
                >
                  <Paperclip className="h-5 w-5 transition-colors" />
                </button>
              </PromptInputAction>

              <AnimatePresence>
                {showPicker && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowPicker(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.97 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                      className="absolute bottom-full left-0 mb-2 z-50 w-80"
                    >
                      <AttachmentManager
                        onToggleFileSelection={toggleFileSelectionForAttachment}
                        selectedAttachments={selectedAttachments}
                        maxAttachments={maxAttachments}
                        onClose={() => setShowPicker(false)}
                      />
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Search / Think toggles */}
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => handleToggleMode("search")}
                className={cn(
                  "rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8",
                  showSearch
                    ? "bg-[#1EAEDB]/15 border-[#1EAEDB] text-[#1EAEDB]"
                    : "bg-transparent border-transparent text-[#9CA3AF] hover:text-[#D1D5DB]"
                )}
              >
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  <motion.div
                    animate={{ rotate: showSearch ? 360 : 0, scale: showSearch ? 1.1 : 1 }}
                    whileHover={{
                      rotate: showSearch ? 360 : 15,
                      scale: 1.1,
                      transition: { type: "spring", stiffness: 300, damping: 10 },
                    }}
                    transition={{ type: "spring", stiffness: 260, damping: 25 }}
                  >
                    <Globe className={cn("w-4 h-4", showSearch ? "text-[#1EAEDB]" : "text-inherit")} />
                  </motion.div>
                </div>
                <AnimatePresence>
                  {showSearch && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: "auto", opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-xs overflow-hidden whitespace-nowrap text-[#1EAEDB] shrink-0"
                    >
                      Search
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              <CustomDivider />

              <button
                type="button"
                onClick={() => handleToggleMode("think")}
                className={cn(
                  "rounded-full transition-all flex items-center gap-1 px-2 py-1 border h-8",
                  showThink
                    ? "bg-[#8B5CF6]/15 border-[#8B5CF6] text-[#8B5CF6]"
                    : "bg-transparent border-transparent text-[#9CA3AF] hover:text-[#D1D5DB]"
                )}
              >
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  <motion.div
                    animate={{ rotate: showThink ? 360 : 0, scale: showThink ? 1.1 : 1 }}
                    whileHover={{
                      rotate: showThink ? 360 : 15,
                      scale: 1.1,
                      transition: { type: "spring", stiffness: 300, damping: 10 },
                    }}
                    transition={{ type: "spring", stiffness: 260, damping: 25 }}
                  >
                    <BrainCog className={cn("w-4 h-4", showThink ? "text-[#8B5CF6]" : "text-inherit")} />
                  </motion.div>
                </div>
                <AnimatePresence>
                  {showThink && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: "auto", opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-xs overflow-hidden whitespace-nowrap text-[#8B5CF6] shrink-0"
                    >
                      Think
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </div>
          </div>

          {/* ── Send / Voice / Stop ── */}
          <PromptInputAction tooltip={sendTooltip}>
            <Button
              variant="default"
              size="icon"
              className={cn(
                "h-8 w-8 rounded-full transition-all duration-200",
                isRecording
                  ? "bg-transparent hover:bg-gray-600/30 text-red-500 hover:text-red-400"
                  : canSend
                    ? "bg-white hover:bg-white/80 text-[#1F2023]"
                    : "bg-transparent hover:bg-gray-600/30 text-[#9CA3AF] hover:text-[#D1D5DB]"
              )}
              onClick={() => {
                if (isRecording) setIsRecording(false);
                else if (canSend) handleSubmit();
                else if (!anyParsing) setIsRecording(true);
              }}
              disabled={isLoading && !hasContent}
              aria-label={sendTooltip}
            >
              {isLoading ? (
                <Square className="h-4 w-4 fill-[#1F2023] animate-pulse" />
              ) : isRecording ? (
                <StopCircle className="h-5 w-5 text-red-500" />
              ) : canSend ? (
                <ArrowUp className="h-4 w-4 text-[#1F2023]" />
              ) : anyParsing ? (
                <Loader2 className="h-4 w-4 text-[#9CA3AF] animate-spin" />
              ) : (
                <Mic className="h-5 w-5 text-[#1F2023] transition-colors" />
              )}
            </Button>
          </PromptInputAction>
        </PromptInputActions>
      </PromptInput>
    );
  }
);
PromptInputBox.displayName = "PromptInputBox";