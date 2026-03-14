// --- Redirect Logs to Main Process ---
const oldLog = console.log;
const oldWarn = console.warn;
const oldError = console.error;

console.log = (...args) => {
    oldLog(...args);
    if (window.electronAPI && window.electronAPI.logToServer) {
        window.electronAPI.logToServer(args.join(' '));
    }
};
console.warn = (...args) => {
    oldWarn(...args);
    if (window.electronAPI && window.electronAPI.logToServer) {
        window.electronAPI.logToServer(`[WARN] ${args.join(' ')}`);
    }
};
console.error = (...args) => {
    oldError(...args);
    if (window.electronAPI && window.electronAPI.logToServer) {
        window.electronAPI.logToServer(`[ERROR] ${args.join(' ')}`);
    }
};

console.log('--- Renderer Process Initializing ---');

// --- Global Error Diagnostic ---
window.onerror = function(msg, url, line, col, error) {
    console.log(`[FATAL ERROR] ${msg} at line ${line}:${col}`);
    return false;
};

const noteArea = document.getElementById('note-content');
const titleInput = document.getElementById('note-title');
console.log(`[Diagnostic] noteArea found: ${!!noteArea}, titleInput found: ${!!titleInput}`);

let timeout = null;
let currentNoteId = null;

// Initial hydration from Main Process
window.electronAPI.onLoadNote((note) => {
    console.log(`[IPC] Received load-note for ID: ${note.id}`);
    currentNoteId = note.id;
    if (note.content) noteArea.innerHTML = note.content;
    if (titleInput) {
        titleInput.value = note.name || '';
    }
});

// Save note name with debounce
if (titleInput) {
    titleInput.addEventListener('input', () => {
        clearTimeout(titleInput._t);
        titleInput._t = setTimeout(() => {
            if (currentNoteId) {
                console.log(`[Action] Saving title for: ${currentNoteId}`);
                window.electronAPI.saveName(currentNoteId, titleInput.value.trim());
            }
        }, 600);
    });
    
    // Prevent drag while typing in the title
    titleInput.addEventListener('mousedown', e => e.stopPropagation());
}

// Global Refresh Shortcut (Ctrl+R)
window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'r') {
        console.log('[Shortcut] Ctrl+R triggered - Reloading note data');
        window.location.reload();
    }
});

// --- Focus/Blur State Management ---
// Used to hide buttons and toolbar when window is inactive
window.addEventListener('focus', () => {
    document.body.classList.add('is-focused');
    document.body.classList.remove('is-blurred');
});

window.addEventListener('blur', () => {
    document.body.classList.remove('is-focused');
    document.body.classList.add('is-blurred');
});

// Initial state
if (document.hasFocus()) {
    document.body.classList.add('is-focused');
} else {
    document.body.classList.add('is-blurred');
}



// --- HELPER: Null-safe listener ---
const safeListen = (id, event, cb) => {
    const el = document.getElementById(id);
    if (el) {
        console.log(`[Init] Binding ${event} to #${id}`);
        el.addEventListener(event, (e) => {
            console.log(`[Event] ${event} triggered on #${id}`);
            cb(e);
        });
    } else {
        console.warn(`[Init] FAILED: Element #${id} not found`);
    }
};

// --- CORE SYSTEM LISTENERS ---

safeListen('add-btn', 'click', (e) => {
    e.stopPropagation();
    window.electronAPI.newNote();
});

safeListen('close-btn', 'click', (e) => {
    e.stopPropagation();
    if (currentNoteId) window.electronAPI.closeNote(currentNoteId);
});

safeListen('tray-trigger', 'click', (e) => {
    e.stopPropagation();
    if (currentNoteId && confirm('Delete this note permanently?')) {
        window.electronAPI.deleteNotePermanent(currentNoteId);
    }
});

if (noteArea) {
    noteArea.addEventListener('input', () => {
        // 1. Instantly magnetize checkboxes to the absolute beginning of their respective lines
        const wrappers = noteArea.querySelectorAll('.cb-wrapper');
        wrappers.forEach(wrapper => {
            let current = wrapper.previousSibling;
            let lineStartNode = wrapper;
            
            while (current && current.nodeName !== 'BR' && !['DIV', 'P', 'LI'].includes(current.nodeName)) {
                lineStartNode = current;
                current = current.previousSibling;
            }
            
            if (lineStartNode !== wrapper) {
                // Automatically push the checkbox to the far left of whatever was typed!
                wrapper.parentNode.insertBefore(wrapper, lineStartNode);
            }
        });
        
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            if (currentNoteId) {
                const content = noteArea.innerHTML;
                window.electronAPI.saveContent(currentNoteId, content);
            }
        }, 1000);
    });
}
 
// Robust DPI-aware Resizing logic
const resizeHandle = document.querySelector('.resize-handle');
let isResizing = false;
let startWidth, startHeight, startX, startY;
let resizeTicking = false;
 
if (resizeHandle) {
    resizeHandle.addEventListener('pointerdown', (e) => {
        isResizing = true;
        startX = e.screenX;
        startY = e.screenY;
        startWidth = window.outerWidth;
        startHeight = window.outerHeight;
        
        resizeHandle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
}
 
window.addEventListener('pointermove', (e) => {
    if (!isResizing || resizeTicking) return;
    
    resizeTicking = true;
    requestAnimationFrame(() => {
        // Calculate deltas and account for system DPI scaling
        const dpi = window.devicePixelRatio || 1;
        const deltaX = (e.screenX - startX) / dpi;
        const deltaY = (e.screenY - startY) / dpi;
        
        const newWidth = Math.max(200, startWidth + deltaX);
        const newHeight = Math.max(200, startHeight + deltaY);
        
        window.electronAPI.resizeWindow(Math.round(newWidth), Math.round(newHeight));
        resizeTicking = false;
    });
});

window.addEventListener('pointerup', (e) => {
    if (isResizing) {
        isResizing = false;
        resizeHandle.releasePointerCapture(e.pointerId);
    }
});

// Rich Text Formatting Logic
window.formatDoc = function(cmd) {
    if (cmd === 'insertUnorderedList') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            let startContainer = range.startContainer;
            let startOffset = range.startOffset;
            
            let container = startContainer;
            while (container && container !== noteArea && !['DIV', 'P', 'LI'].includes(container.nodeName)) {
                container = container.parentNode;
            }

            if (container) {
                let insertionPointNode = null;
                if (container !== noteArea) {
                    insertionPointNode = container.firstChild;
                } else {
                    let current = startContainer;
                    if (current === noteArea) {
                        current = noteArea.childNodes[startOffset] || noteArea.lastChild;
                    } else {
                        while (current && current.parentNode !== noteArea) {
                            current = current.parentNode;
                        }
                    }
                    while (current && current.previousSibling && 
                           current.previousSibling.nodeName !== 'BR' && 
                           !['DIV', 'P', 'LI'].includes(current.previousSibling.nodeName)) {
                        current = current.previousSibling;
                    }
                    insertionPointNode = current;
                }

                let checkNode = insertionPointNode;
                while (checkNode && checkNode.nodeType === Node.TEXT_NODE && checkNode.textContent.trim() === '') {
                    checkNode = checkNode.nextSibling;
                }
                
                if (checkNode && checkNode.nodeType === Node.ELEMENT_NODE && checkNode.classList.contains('cb-wrapper')) {
                    let existingCb = checkNode.querySelector('input[type="checkbox"]');
                    if (existingCb) {
                        existingCb.checked = false;
                        existingCb.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    
                    let next = checkNode.nextSibling;
                    if (next && next.nodeType === Node.TEXT_NODE && (next.textContent.startsWith('\u00A0') || next.textContent.startsWith(' '))) {
                        next.textContent = next.textContent.substring(1);
                        if (next.textContent === '') next.remove();
                    }
                    checkNode.remove();
                }
            }
        }
    }

    document.execCommand(cmd, false, null);
    noteArea.focus();

    // After inserting a bullet point, move cursor to the end of that line
    if (cmd === 'insertUnorderedList') {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            let node = sel.getRangeAt(0).startContainer;
            // Walk up to find the LI (or the closest block)
            while (node && node !== noteArea && node.nodeName !== 'LI') {
                node = node.parentNode;
            }
            if (node && node.nodeName === 'LI') {
                // Find the deepest last child (last text node on this line)
                let last = node;
                while (last.lastChild) last = last.lastChild;
                
                try {
                    const newRange = document.createRange();
                    if (last.nodeType === Node.TEXT_NODE) {
                        newRange.setStart(last, last.length);
                    } else {
                        newRange.setStartAfter(last);
                    }
                    newRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(newRange);
                } catch(e) {}
            }
        }
    }
};

window.insertCheckbox = function() {
    noteArea.focus();
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    let startContainer = range.startContainer;
    let startOffset = range.startOffset;
    
    // 1. Find the enclosing block (DIV, P, LI) or default to noteArea
    let container = startContainer;
    while (container && container !== noteArea && !['DIV', 'P', 'LI'].includes(container.nodeName)) {
        container = container.parentNode;
    }

    if (!container) return;
    
    // If the line is currently a bullet point, convert it back to normal text first
    if (container.nodeName === 'LI') {
        document.execCommand('insertUnorderedList', false, null);
        
        // Re-calculate container and selection after the DOM change
        const newSelection = window.getSelection();
        if (newSelection.rangeCount > 0) {
            startContainer = newSelection.getRangeAt(0).startContainer;
            startOffset = newSelection.getRangeAt(0).startOffset;
            container = startContainer;
            while (container && container !== noteArea && !['DIV', 'P', 'LI'].includes(container.nodeName)) {
                container = container.parentNode;
            }
            if (!container) return;
        } else {
            return;
        }
    }

    let existingCb = null;
    let insertionPointNode = null;
    let insertionParent = null;

    if (container !== noteArea) {
        insertionParent = container;
        insertionPointNode = container.firstChild;
    } else {
        insertionParent = noteArea;
        let current = startContainer;
        if (current === noteArea) {
            current = noteArea.childNodes[startOffset] || noteArea.lastChild;
        } else {
            while (current && current.parentNode !== noteArea) {
                current = current.parentNode;
            }
        }

        while (current && current.previousSibling && 
               current.previousSibling.nodeName !== 'BR' && 
               !['DIV', 'P', 'LI'].includes(current.previousSibling.nodeName)) {
            current = current.previousSibling;
        }
        
        insertionPointNode = current;
    }

    let checkNode = insertionPointNode;
    while (checkNode && checkNode.nodeType === Node.TEXT_NODE && checkNode.textContent.trim() === '') {
        checkNode = checkNode.nextSibling;
    }
    
    if (checkNode && checkNode.nodeType === Node.ELEMENT_NODE && checkNode.classList.contains('cb-wrapper')) {
        existingCb = checkNode.querySelector('input[type="checkbox"]');
    }

    if (existingCb) {
        // Uncheck to remove strikethrough logic
        existingCb.checked = false;
        existingCb.dispatchEvent(new Event('change', { bubbles: true }));
        
        let wrapper = existingCb.closest('.cb-wrapper');
        let cursorNode = insertionPointNode;
        if(wrapper) {
            let next = wrapper.nextSibling;
            if (next && next.nodeType === Node.TEXT_NODE && (next.textContent.startsWith('\u00A0') || next.textContent.startsWith(' '))) {
                next.textContent = next.textContent.substring(1);
                if (next.textContent === '') {
                    cursorNode = next.nextSibling || wrapper.previousSibling || wrapper.parentNode;
                    next.remove();
                } else {
                    cursorNode = next;
                }
            } else if (next) {
                cursorNode = next;
            } else {
                cursorNode = wrapper.previousSibling || wrapper.parentNode;
            }
            wrapper.remove();
        } else {
            cursorNode = existingCb.nextSibling || existingCb.parentNode;
            existingCb.remove();
        }

        // Force the cursor to sit at the end of the current line safely
        try {
            let newRange = document.createRange();

            // If cursorNode is an element (block container / noteArea), the line is empty.
            // Place cursor directly inside it rather than scanning siblings.
            if (cursorNode && cursorNode.nodeType === Node.ELEMENT_NODE) {
                newRange.selectNodeContents(cursorNode);
                newRange.collapse(false); // collapse to end (empty = same as start)
            } else {
                // Scan forward to find the last node on this line
                let lastNodeOnLine = cursorNode;
                let current = cursorNode;
                while(current && current.nodeName !== 'BR' && current.nodeName !== 'DIV' && current.nodeName !== 'P' && current.nodeName !== 'LI') {
                    lastNodeOnLine = current;
                    current = current.nextSibling;
                }

                if (lastNodeOnLine && lastNodeOnLine.nodeType === Node.TEXT_NODE) {
                    newRange.setStart(lastNodeOnLine, lastNodeOnLine.length);
                } else if (lastNodeOnLine) {
                    newRange.setStartAfter(lastNodeOnLine);
                } else {
                    newRange.selectNodeContents(insertionParent);
                    newRange.collapse(false);
                }
            }
            
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
            return; // Exit early to avoid the generic restore logic below
        } catch(e) {}
    } else {
        // Insert new checkbox inside a non-editable wrapper
        let wrapper = document.createElement('span');
        wrapper.className = 'cb-wrapper';
        wrapper.contentEditable = "false";
        
        let cb = document.createElement('input');
        cb.type = 'checkbox';
        wrapper.appendChild(cb);
        
        // Add a space AFTER the wrapper, in the editable area
        let space = document.createTextNode('\u00A0'); 
        
        insertionParent.insertBefore(wrapper, insertionPointNode);
        insertionParent.insertBefore(space, insertionPointNode);
        
        // Force the cursor to sit at the end of the current line
        try {
            let newRange = document.createRange();
            
            let lastNodeOnLine = space;
            let current = space.nextSibling;
            while(current && current.nodeName !== 'BR' && current.nodeName !== 'DIV' && current.nodeName !== 'P' && current.nodeName !== 'LI') {
                lastNodeOnLine = current;
                current = current.nextSibling;
            }

            if (lastNodeOnLine.nodeType === Node.TEXT_NODE) {
                newRange.setStart(lastNodeOnLine, lastNodeOnLine.length);
            } else {
                newRange.setStartAfter(lastNodeOnLine);
            }
            
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
            return; // Exit early to avoid the generic restore logic below
        } catch(e) {}
    }
    
    // Generic attempt to restore selection if we didn't firmly set it above
    try {
        let newRange = document.createRange();
        if (document.body.contains(startContainer)) {
            newRange.setStart(startContainer, startOffset);
            newRange.collapse(true);
        } else {
            newRange.selectNodeContents(noteArea);
            newRange.collapse(false);
        }
        selection.removeAllRanges();
        selection.addRange(newRange);
    } catch(e) {}
    
    noteArea.dispatchEvent(new Event('input'));
};

// Handle 'Enter' and 'Backspace' to mimic bullet point behavior for checkboxes
noteArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Backspace') {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        let node = range.startContainer;
        let offset = range.startOffset;

        // Find enclosing block or root
        let container = node;
        while (container && container !== noteArea && !['DIV', 'P', 'LI'].includes(container.nodeName)) {
            container = container.parentNode;
        }

        if (!container) return;

        let cbWrapper = null;
        if (container !== noteArea) {
            if (container.firstChild && container.firstChild.nodeType === Node.ELEMENT_NODE && container.firstChild.classList.contains('cb-wrapper')) {
                cbWrapper = container.firstChild;
            }
        } else {
            // Check direct children backwards from cursor
            let current = node;
            if (node === noteArea) current = noteArea.childNodes[offset] || noteArea.lastChild;
            while (current && current.previousSibling && current.previousSibling.nodeName !== 'BR') {
                current = current.previousSibling;
            }
            if (current && current.nodeType === Node.ELEMENT_NODE && current.classList.contains('cb-wrapper')) {
                cbWrapper = current;
            }
        }

        if (cbWrapper) {
            // Check if there is actual meaningful text *after* the checkbox on this line
            let nextNode = cbWrapper.nextSibling;
            let isEmpty = true;
            
            while (nextNode && nextNode.nodeName !== 'BR' && nextNode.nodeName !== 'DIV' && nextNode.nodeName !== 'P' && nextNode.nodeName !== 'LI') {
                if (nextNode.nodeType === Node.TEXT_NODE) {
                    if (nextNode.textContent.trim() !== '') {
                        isEmpty = false;
                        break;
                    }
                } else if (nextNode.nodeType === Node.ELEMENT_NODE) {
                    if (nextNode.textContent.trim() !== '' || nextNode.tagName === 'IMG') {
                        isEmpty = false;
                        break;
                    }
                }
                nextNode = nextNode.nextSibling;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                
                if (isEmpty) {
                    // Stop continuing the list: Remove the checkbox and insert a normal new line
                    cbWrapper.remove();
                    if (nextNode && nextNode.nodeType === Node.TEXT_NODE) nextNode.remove(); // remove trailing space
                    document.execCommand('insertParagraph', false);
                    
                    // Cleanup any leftover strickthrough formatting
                    document.execCommand('removeFormat', false, null);
                } else {
                    // Clever fix for browser inheritance:
                    // Force the line to uncheck itself to delete all checked-text HTML wraps
                    // BEFORE we tell the browser to break to a new line. 
                    // This way it has zero inherited styling to carry over!
                    const cb = cbWrapper.querySelector('input[type="checkbox"]');
                    const wasChecked = cb.checked;
                    
                    if (wasChecked) {
                        cb.checked = false;
                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    
                    document.execCommand('insertParagraph', false);
                    document.execCommand('removeFormat', false, null);
                    
                    if (wasChecked) {
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    
                    window.insertCheckbox(); // Re-use the smart toggle logic which will insert a fresh box at the new line
                }
            } else if (e.key === 'Backspace' && isEmpty) {
                // If pressing backspace on an empty checkbox line, just remove the checkbox
                e.preventDefault();
                cbWrapper.remove();
                if (nextNode && nextNode.nodeType === Node.TEXT_NODE) nextNode.remove();
            }
        }
    }
});

// Listen for change events (e.g., when a checkbox is clicked)
noteArea.addEventListener('change', (e) => {
    if (e.target && e.target.type === 'checkbox') {
        const isChecked = e.target.checked;
        const wrapper = e.target.closest('.cb-wrapper');
        let next = wrapper ? wrapper.nextSibling : e.target.nextSibling;
        
        // Loop through siblings on the same line to apply or remove strike-through
        while (next && next.nodeName !== 'BR' && next.nodeName !== 'DIV' && next.nodeName !== 'P' && next.nodeName !== 'LI') {
            if (isChecked) {
                if (next.nodeType === Node.TEXT_NODE) {
                    const span = document.createElement('span');
                    span.className = 'checked-text';
                    next.parentNode.insertBefore(span, next);
                    span.appendChild(next);
                    next = span; // Adjust pointer for next iteration
                } else if (next.nodeType === Node.ELEMENT_NODE && next.tagName !== 'INPUT') {
                    next.classList.add('checked-text');
                }
            } else {
                if (next.nodeType === Node.ELEMENT_NODE && next.classList.contains('checked-text')) {
                    if (next.tagName === 'SPAN') {
                        const parent = next.parentNode;
                        let lastExtracted = next;
                        while(next.firstChild) {
                            lastExtracted = next.firstChild;
                            parent.insertBefore(lastExtracted, next);
                        }
                        const toRemove = next;
                        next = lastExtracted; // Adjust pointer to the last extracted node
                        toRemove.parentNode.removeChild(toRemove);
                    } else {
                        next.classList.remove('checked-text');
                    }
                }
            }
            next = next.nextSibling;
        }
    }
    // Trigger input event to save state
    noteArea.dispatchEvent(new Event('input'));
});

// Actively defend the space to the left of the checkbox against the cursor
document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;
    if (!noteArea.contains(selection.anchorNode)) return;

    const range = selection.getRangeAt(0);
    if (!range.collapsed) return;

    let node = range.startContainer;
    let offset = range.startOffset;
    let targetWrapper = null;

    // Check if cursor breached into the space before the wrapper element
    if (node.nodeType === Node.ELEMENT_NODE) {
        let child = node.childNodes[offset];
        if (child && child.nodeType === Node.ELEMENT_NODE && child.classList.contains('cb-wrapper')) {
            targetWrapper = child;
        }
    } else if (node.nodeType === Node.TEXT_NODE) {
        // If cursor is stuck inside a text node immediately preceding a wrapper
        if (offset === node.length) {
            let next = node.nextSibling;
            if (next && next.nodeType === Node.ELEMENT_NODE && next.classList.contains('cb-wrapper')) {
                targetWrapper = next;
            }
        }
    }

    if (targetWrapper) {
        // The cursor has successfully bypassed the CSS wall. Repel it to the right side!
        let nextText = targetWrapper.nextSibling;
        let newRange = document.createRange();
        
        if (nextText && nextText.nodeType === Node.TEXT_NODE) {
            newRange.setStart(nextText, nextText.textContent.startsWith('\u00A0') ? 1 : 0);
        } else {
            newRange.setStartAfter(targetWrapper);
        }
        
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
    }
});

// --- Toolbar Button Listeners ---
const attachListener = (id, cmd, isFormat = true) => {
    const el = document.getElementById(id);
    if (el) {
        console.log(`[Init] Attached Toolbar action to #${id}`);
        el.onclick = () => {
            console.log(`[Action] Toolbar Button Clicked: #${id}`);
            if (isFormat) window.formatDoc(cmd);
            else window.insertCheckbox();
        };
    } else {
        console.warn(`[Init] Toolbar element #${id} not found in DOM`);
    }
};

attachListener('bold-btn', 'bold');
attachListener('italic-btn', 'italic');
attachListener('underline-btn', 'underline');
attachListener('strike-btn', 'strikeThrough');
attachListener('list-btn', 'insertUnorderedList');
attachListener('cb-btn', null, false);
