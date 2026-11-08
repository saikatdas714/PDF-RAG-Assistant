/**
 * Project AI - PDF RAG Assistant
 * Frontend Application Logic: Responsive Layout, Tabs, Chat & Session Cleanup
 */

document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements - Mobile Navigation
  const tabDocBtn = document.getElementById("tabDocBtn");
  const tabChatBtn = document.getElementById("tabChatBtn");
  const sidebarView = document.getElementById("sidebarView");
  const chatView = document.getElementById("chatView");
  const docStatusDot = document.getElementById("docStatusDot");

  // DOM Elements - Sidebar Subtabs
  const subtabUploadBtn = document.getElementById("subtabUploadBtn");
  const subtabPreviewBtn = document.getElementById("subtabPreviewBtn");
  const uploadTabContent = document.getElementById("uploadTabContent");
  const previewTabContent = document.getElementById("previewTabContent");
  const copyTextBtn = document.getElementById("copyTextBtn");
  const copyBtnText = document.getElementById("copyBtnText");

  // DOM Elements - File Upload
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const filePill = document.getElementById("filePill");
  const fileNameDisplay = document.getElementById("fileNameDisplay");
  const fileSizeDisplay = document.getElementById("fileSizeDisplay");
  const removeFileBtn = document.getElementById("removeFileBtn");
  const uploadBtn = document.getElementById("uploadBtn");
  const uploadBtnText = document.getElementById("uploadBtnText");
  const uploadSpinner = document.getElementById("uploadSpinner");
  const uploadStatus = document.getElementById("uploadStatus");
  const textPreview = document.getElementById("textPreview");
  const charCounter = document.getElementById("charCounter");

  // DOM Elements - Chat & Actions
  const chatMessages = document.getElementById("chatMessages");
  const chatForm = document.getElementById("chatForm");
  const questionInput = document.getElementById("questionInput");
  const sendBtn = document.getElementById("sendBtn");
  const sendBtnText = document.getElementById("sendBtnText");
  const sendSpinner = document.getElementById("sendSpinner");
  const clearChatBtn = document.getElementById("clearChatBtn");
  const endSessionBtn = document.getElementById("endSessionBtn");
  const modelSelect = document.getElementById("modelSelect");

  let activeFile = null;
  let sessionPointIds = [];

  // --------------------------------------------------------------------------
  // Model Switcher Integration
  // --------------------------------------------------------------------------
  async function syncModelList() {
    if (!modelSelect) return;
    try {
      const res = await fetch("/models");
      if (!res.ok) return;
      const data = await res.json();
      if (data.generationPriority && data.generationPriority.length > 0) {
        modelSelect.innerHTML = "";
        data.generationPriority.forEach((m) => {
          const opt = document.createElement("option");
          opt.value = m;
          opt.textContent = m;
          if (m === data.activeGenerationModel) opt.selected = true;
          modelSelect.appendChild(opt);
        });
      }
    } catch (_) {}
  }
  syncModelList();

  if (modelSelect) {
    modelSelect.addEventListener("change", async () => {
      const selectedModel = modelSelect.value;
      try {
        const res = await fetch("/switch-model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: selectedModel }),
        });
        const data = await res.json();
        if (res.ok) {
          appendSystemNotification(`Active model switched to ${data.activeGenerationModel}`);
        } else {
          alert("Failed to switch model: " + (data.error || "Unknown error"));
          syncModelList();
        }
      } catch (err) {
        alert("Error connecting to server: " + err.message);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Mobile View Navigation (Switch between Document and Chat on Mobile)
  // --------------------------------------------------------------------------
  function switchMobileTab(targetView) {
    if (targetView === "sidebarView") {
      tabDocBtn.classList.add("active");
      tabChatBtn.classList.remove("active");
      sidebarView.classList.add("mobile-active");
      chatView.classList.remove("mobile-active");
    } else {
      tabChatBtn.classList.add("active");
      tabDocBtn.classList.remove("active");
      chatView.classList.add("mobile-active");
      sidebarView.classList.remove("mobile-active");
      scrollToBottom();
    }
  }

  if (tabDocBtn && tabChatBtn) {
    tabDocBtn.addEventListener("click", () => switchMobileTab("sidebarView"));
    tabChatBtn.addEventListener("click", () => switchMobileTab("chatView"));
  }

  // --------------------------------------------------------------------------
  // Sidebar Sub-tabs (Upload vs Extracted Preview)
  // --------------------------------------------------------------------------
  subtabUploadBtn.addEventListener("click", () => {
    subtabUploadBtn.classList.add("active");
    subtabPreviewBtn.classList.remove("active");
    uploadTabContent.classList.add("active");
    previewTabContent.classList.remove("active");
  });

  subtabPreviewBtn.addEventListener("click", () => {
    subtabPreviewBtn.classList.add("active");
    subtabUploadBtn.classList.remove("active");
    previewTabContent.classList.add("active");
    uploadTabContent.classList.remove("active");
  });

  // Copy parsed text to clipboard
  if (copyTextBtn) {
    copyTextBtn.addEventListener("click", async () => {
      const textToCopy = textPreview.textContent;
      if (!textToCopy || textToCopy.startsWith("No document")) return;

      try {
        await navigator.clipboard.writeText(textToCopy);
        copyBtnText.textContent = "Copied!";
        setTimeout(() => {
          copyBtnText.textContent = "Copy";
        }, 1500);
      } catch (e) {
        copyBtnText.textContent = "Error";
      }
    });
  }

  // --------------------------------------------------------------------------
  // Drag and Drop & File Selection
  // --------------------------------------------------------------------------
  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      selectFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) {
      selectFile(e.target.files[0]);
    }
  });

  function selectFile(file) {
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      showStatus("Please choose a valid .pdf file.", "error");
      return;
    }

    activeFile = file;
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = formatBytes(file.size);
    filePill.classList.remove("hidden");
    uploadBtn.disabled = false;
    hideStatus();
  }

  removeFileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    activeFile = null;
    fileInput.value = "";
    filePill.classList.add("hidden");
    uploadBtn.disabled = true;
    hideStatus();
  });

  function formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function showStatus(message, type = "loading") {
    uploadStatus.className = `status-box ${type}`;
    uploadStatus.textContent = message;
    uploadStatus.classList.remove("hidden");
  }

  function hideStatus() {
    uploadStatus.classList.add("hidden");
  }

  // --------------------------------------------------------------------------
  // Upload & Index Action
  // --------------------------------------------------------------------------
  uploadBtn.addEventListener("click", async () => {
    if (!activeFile) return;

    uploadBtn.disabled = true;
    uploadSpinner.classList.remove("hidden");
    uploadBtnText.textContent = "Processing & Indexing...";
    showStatus("Extracting PDF, generating embeddings, and indexing into Qdrant...", "loading");

    const formData = new FormData();
    formData.append("pdf", activeFile);

    try {
      const response = await fetch("/uploads", {
        method: "POST",
        body: formData,
      });

      const contentType = response.headers.get("content-type") || "";
      let resultData;
      let rawText = "";

      if (contentType.includes("application/json")) {
        resultData = await response.json();
        rawText = resultData.text || "";
        if (Array.isArray(resultData.pointIds)) {
          sessionPointIds.push(...resultData.pointIds);
        }
      } else {
        rawText = await response.text();
        const match = rawText.match(/Extracted PDF:\s*([\s\S]*)$/);
        rawText = match ? match[1].trim() : rawText;
      }

      if (response.ok) {
        showStatus("✓ Successfully indexed into Qdrant vector database!", "success");
        textPreview.textContent = rawText;
        charCounter.textContent = `${rawText.length} chars`;

        if (docStatusDot) docStatusDot.classList.add("active");

        appendSystemNotification(`Indexed "${activeFile.name}" into Qdrant (${sessionPointIds.length} vectors stored).`);

        // If on mobile screen, automatically switch over to Chat tab
        if (window.innerWidth <= 899) {
          setTimeout(() => {
            switchMobileTab("chatView");
          }, 800);
        }
      } else {
        showStatus(`Upload failed: ${resultData ? resultData.error : rawText}`, "error");
      }
    } catch (err) {
      showStatus(`Network error: ${err.message}`, "error");
    } finally {
      uploadBtn.disabled = false;
      uploadSpinner.classList.add("hidden");
      uploadBtnText.textContent = "Upload & Index into Qdrant";
    }
  });

  // --------------------------------------------------------------------------
  // Ask AI Q&A Form
  // --------------------------------------------------------------------------
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = questionInput.value.trim();
    if (!question) return;

    appendMessage("user", question);
    questionInput.value = "";
    questionInput.style.height = "44px";

    sendBtn.disabled = true;
    sendSpinner.classList.remove("hidden");
    sendBtnText.textContent = "";

    const loadingId = appendLoadingIndicator();

    try {
      const response = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          model: modelSelect ? modelSelect.value : undefined,
        }),
      });

      const data = await response.json();
      removeElement(loadingId);

      if (response.ok) {
        if (data.modelUsed && modelSelect && modelSelect.value !== data.modelUsed) {
          modelSelect.value = data.modelUsed;
          appendSystemNotification(`Auto-switched to available model: ${data.modelUsed}`);
        }
        appendMessage("ai", data.answer || "No response generated.", data.context);
      } else {
        appendMessage("ai", `⚠️ Error: ${data.error || "Unable to retrieve answer."}`);
      }
    } catch (err) {
      removeElement(loadingId);
      appendMessage("ai", `⚠️ Failed to connect to server: ${err.message}`);
    } finally {
      sendBtn.disabled = false;
      sendSpinner.classList.add("hidden");
      sendBtnText.textContent = "Ask";
    }
  });

  // Submit on Enter (Shift+Enter for newline)
  questionInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event("submit"));
    }
  });

  // Auto-resize input textarea up to 110px
  questionInput.addEventListener("input", function() {
    this.style.height = "44px";
    this.style.height = Math.min(this.scrollHeight, 110) + "px";
  });

  clearChatBtn.addEventListener("click", () => {
    chatMessages.innerHTML = "";
    appendSystemNotification("Chat history cleared.");
  });

  window.setQuickPrompt = (promptText) => {
    questionInput.value = promptText;
    questionInput.focus();
    if (window.innerWidth <= 899) {
      switchMobileTab("chatView");
    }
  };

  // --------------------------------------------------------------------------
  // Session & Qdrant Cleanup
  // --------------------------------------------------------------------------
  if (endSessionBtn) {
    endSessionBtn.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to end this session and delete all indexed vectors from Qdrant?")) {
        return;
      }

      endSessionBtn.disabled = true;
      endSessionBtn.innerHTML = `Cleaning...`;

      try {
        await fetch("/clear-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pointIds: sessionPointIds }),
        });

        sessionPointIds = [];
        activeFile = null;
        fileInput.value = "";
        filePill.classList.add("hidden");
        uploadBtn.disabled = true;
        textPreview.textContent = "No document loaded yet. Upload a PDF on the left to inspect parsed text.";
        charCounter.textContent = "0 chars";
        if (docStatusDot) docStatusDot.classList.remove("active");
        showStatus("✓ Qdrant session index deleted successfully.", "success");
        appendSystemNotification("Session ended: All vector embeddings deleted from Qdrant.");
      } catch (err) {
        alert("Failed to delete Qdrant index: " + err.message);
      } finally {
        endSessionBtn.disabled = false;
        endSessionBtn.innerHTML = `
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 14px; height: 14px;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span class="btn-text">Reset Session</span>
        `;
      }
    });
  }

  // Automatic beacon cleanup when browser is closed
  window.addEventListener("beforeunload", () => {
    if (sessionPointIds.length > 0) {
      const payload = JSON.stringify({ pointIds: sessionPointIds });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/clear-session", payload);
      } else {
        fetch("/clear-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        });
      }
    }
  });

  // --------------------------------------------------------------------------
  // Message Rendering
  // --------------------------------------------------------------------------
  function appendMessage(sender, text, context = null) {
    const row = document.createElement("div");
    row.className = `msg-row ${sender}`;

    const avatar = document.createElement("div");
    avatar.className = `avatar ${sender}`;
    avatar.textContent = sender === "user" ? "You" : "AI";

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    const textPara = document.createElement("p");
    textPara.style.whiteSpace = "pre-wrap";
    textPara.textContent = text;
    bubble.appendChild(textPara);

    if (context) {
      const details = document.createElement("details");
      details.className = "context-details";

      const summary = document.createElement("summary");
      summary.className = "context-summary";
      summary.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        Matched Qdrant Vector Context
      `;

      const content = document.createElement("div");
      content.className = "context-content";
      content.textContent = context;

      details.appendChild(summary);
      details.appendChild(content);
      bubble.appendChild(details);
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
  }

  function appendSystemNotification(text) {
    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.justifyContent = "center";
    wrapper.style.margin = "0.4rem 0";

    const pill = document.createElement("span");
    pill.style.fontSize = "0.72rem";
    pill.style.color = "#a5b4fc";
    pill.style.background = "rgba(99, 102, 241, 0.12)";
    pill.style.border = "1px solid rgba(99, 102, 241, 0.25)";
    pill.style.borderRadius = "999px";
    pill.style.padding = "0.2rem 0.75rem";
    pill.textContent = text;

    wrapper.appendChild(pill);
    chatMessages.appendChild(wrapper);
    scrollToBottom();
  }

  function appendLoadingIndicator() {
    const id = "loading-" + Date.now();
    const row = document.createElement("div");
    row.id = id;
    row.className = "msg-row ai";

    const avatar = document.createElement("div");
    avatar.className = "avatar ai";
    avatar.textContent = "AI";

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.innerHTML = `<span style="opacity: 0.75;">Searching vectors & generating answer...</span>`;

    row.appendChild(avatar);
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
    return id;
  }

  function removeElement(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
});
