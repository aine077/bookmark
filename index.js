/**
 * Message Bookmarks Extension for SillyTavern
 * 북마크, 하이라이트, 메모 기능
 */

import { chat_metadata, saveSettingsDebounced, eventSource, event_types, chat, getCurrentChatId, characters, this_chid, name1, name2, selectCharacterById, openCharacterChat } from '../../../../script.js';
import { getContext, extension_settings, saveMetadataDebounced, renderExtensionTemplateAsync } from '../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { t } from '../../../i18n.js';
import { selected_group, groups } from '../../../group-chats.js';

const MODULE_NAME = 'message_bookmarks';
const DEBUG = false;

// 기본 설정
const defaultSettings = {
    enabled: true,
    highlightColors: [
        { name: '분홍', color: '#F5d2d2' },
        { name: '초록', color: '#a3ccda' },
        { name: '파랑', color: '#bde3c3' },
        { name: '연분홍', color: '#f8f7ba' },
    
    ],
    bookmarkColors: [
        { name: '분홍', color: '#F5d2d2' },
        { name: '하늘', color: '#a3ccda' },
        { name: '민트', color: '#bde3c3' },
        { name: '보라', color: '#f8f7ba' },
      
    ],
    defaultColor: '#F5d2d2',
    defaultBookmarkColor: '#F5d2d2',
    showBookmarkPanel: true,
    // 전역 북마크 저장소 (모든 채팅방의 북마크)
    globalBookmarks: {},
};

// 북마크 데이터 구조
// chat_metadata.message_bookmarks = {
//     bookmarks: [
//         {
//             id: 'unique-id',
//             messageId: 0,
//             createdAt: timestamp,
//             note: '메모 내용',
//             highlights: [
//                 {
//                     id: 'highlight-id',
//                     text: '하이라이트된 텍스트',
//                     color: '#f5d2d2',
//                     startOffset: 0,
//                     endOffset: 10,
//                     note: '하이라이트 메모'
//                 }
//             ]
//         }
//     ]
// }

/**
 * 고유 ID 생성
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * 현재 채팅 ID 가져오기
 */
function getChatId() {
    return getCurrentChatId() || 'unknown';
}

/**
 * 현재 채팅 이름 가져오기
 */
function getChatName() {
    if (selected_group) {
        const group = groups.find(g => g.id === selected_group);
        return group ? group.name : 'Group Chat';
    }
    return name2 || characters[this_chid]?.name || 'Unknown';
}

/**
 * 확장 설정 로드
 */
function loadSettings() {
    extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};
    
    // 기본값과 병합
    if (!extension_settings[MODULE_NAME].globalBookmarks) {
        extension_settings[MODULE_NAME].globalBookmarks = {};
    }
    // 항상 최신 색상으로 업데이트
    extension_settings[MODULE_NAME].highlightColors = defaultSettings.highlightColors;
    extension_settings[MODULE_NAME].bookmarkColors = defaultSettings.bookmarkColors;
    
    if (extension_settings[MODULE_NAME].enabled === undefined) {
        extension_settings[MODULE_NAME].enabled = true;
    }
}

/**
 * 현재 채팅의 북마크 데이터 가져오기
 */
function getBookmarkData() {
    const chatId = getChatId();
    if (!extension_settings[MODULE_NAME].globalBookmarks[chatId]) {
        extension_settings[MODULE_NAME].globalBookmarks[chatId] = {
            chatName: getChatName(),
            characterId: this_chid,
            groupId: selected_group,
            chatFile: characters[this_chid]?.chat,
            bookmarks: [],
        };
    }
    // 정보 업데이트
    extension_settings[MODULE_NAME].globalBookmarks[chatId].chatName = getChatName();
    extension_settings[MODULE_NAME].globalBookmarks[chatId].characterId = this_chid;
    extension_settings[MODULE_NAME].globalBookmarks[chatId].groupId = selected_group;
    extension_settings[MODULE_NAME].globalBookmarks[chatId].chatFile = characters[this_chid]?.chat;
    return extension_settings[MODULE_NAME].globalBookmarks[chatId];
}

/**
 * 모든 채팅의 북마크 데이터 가져오기
 */
function getAllBookmarkData() {
    return extension_settings[MODULE_NAME].globalBookmarks || {};
}

/**
 * 북마크 데이터 저장
 */
function saveBookmarkData() {
    saveSettingsDebounced();
}

/**
 * 메시지 ID로 북마크 찾기 (현재 채팅에서)
 */
function findBookmarkByMessageId(messageId) {
    const data = getBookmarkData();
    return data.bookmarks.find(b => b.messageId === messageId);
}

/**
 * 북마크 추가
 */
function addBookmark(messageId, note = '', color = null) {
    const data = getBookmarkData();
    const existing = findBookmarkByMessageId(messageId);
    
    // 색상이 지정되지 않으면 설정에서 기본 색상 사용
    const bookmarkColor = color || extension_settings[MODULE_NAME].defaultBookmarkColor || '#F5d2d2';
    
    // 메시지 정보 가져오기
    const message = chat[messageId];
    const messageName = message?.name || 'Unknown';
    const preview = (message?.mes || '').substring(0, 100);

    if (existing) {
        existing.note = note;
        existing.color = bookmarkColor;
        existing.updatedAt = Date.now();
        existing.messageName = messageName;
        existing.preview = preview;
        existing.isHighlightOnly = false;  // 북마크로 전환
    } else {
        data.bookmarks.push({
            id: generateId(),
            messageId: messageId,
            messageName: messageName,
            preview: preview,
            color: bookmarkColor,
            createdAt: Date.now(),
            note: note,
            highlights: [],
            isHighlightOnly: false,
        });
    }

    saveBookmarkData();
    updateBookmarkUI(messageId);
    updateBookmarkPanel();
}

/**
 * 북마크 삭제
 */
function removeBookmark(messageId) {
    const data = getBookmarkData();
    const index = data.bookmarks.findIndex(b => b.messageId === messageId);

    if (index !== -1) {
        data.bookmarks.splice(index, 1);
        saveBookmarkData();
        updateBookmarkUI(messageId);
        updateBookmarkPanel();
    }
}

/**
 * 하이라이트 추가
 */
function addHighlight(messageId, text, color, startOffset, endOffset, note = '') {
    const data = getBookmarkData();
    let bookmark = findBookmarkByMessageId(messageId);

    // 북마크가 없으면 하이라이트 전용 데이터 생성 (북마크 아이콘 표시 안함)
    if (!bookmark) {
        const message = chat[messageId];
        const messageName = message?.name || 'Unknown';
        const preview = (message?.mes || '').substring(0, 100);
        
        data.bookmarks.push({
            id: generateId(),
            messageId: messageId,
            messageName: messageName,
            preview: preview,
            color: null,  // 색상 null = 북마크 아이콘 표시 안함
            createdAt: Date.now(),
            note: '',
            highlights: [],
            isHighlightOnly: true,  // 하이라이트 전용 플래그
        });
        bookmark = findBookmarkByMessageId(messageId);
    }

    const highlight = {
        id: generateId(),
        text: text,
        color: color,
        startOffset: startOffset,
        endOffset: endOffset,
        note: note,
        createdAt: Date.now(),
    };

    bookmark.highlights.push(highlight);
    saveBookmarkData();
    applyHighlights(messageId);
    updateBookmarkPanel();

    return highlight;
}

/**
 * 하이라이트 삭제
 */
function removeHighlight(messageId, highlightId) {
    const bookmark = findBookmarkByMessageId(messageId);
    if (!bookmark) return;

    const index = bookmark.highlights.findIndex(h => h.id === highlightId);
    if (index !== -1) {
        bookmark.highlights.splice(index, 1);
        saveBookmarkData();
        applyHighlights(messageId);
        updateBookmarkPanel();
    }
}

/**
 * 하이라이트 적용
 */
function applyHighlights(messageId) {
    const bookmark = findBookmarkByMessageId(messageId);
    const messageElement = $(`.mes[mesid="${messageId}"] .mes_text`);

    if (!messageElement.length) return;

    // 기존 하이라이트 제거하고 원본 텍스트로 복원
    messageElement.find('.msg-highlight').each(function() {
        $(this).replaceWith($(this).text());
    });

    if (!bookmark || bookmark.highlights.length === 0) return;

    // 하이라이트 적용 (역순으로 적용하여 offset 문제 방지)
    const sortedHighlights = [...bookmark.highlights].sort((a, b) => b.startOffset - a.startOffset);

    // 간단한 방식으로 하이라이트 적용 - 텍스트 검색 기반
    let html = messageElement.html();
    for (const highlight of bookmark.highlights) {
        const escapedText = escapeRegExp(highlight.text);
        const regex = new RegExp(`(?<!<[^>]*)${escapedText}(?![^<]*>)`, 'g');
        html = html.replace(regex, (match) => {
            return `<span class="msg-highlight" data-highlight-id="${highlight.id}" style="background-color: ${highlight.color}; cursor: pointer;" title="${escapeHtml(highlight.note || '')}">${match}</span>`;
        });
    }
    messageElement.html(html);
}

/**
 * 정규식 특수문자 이스케이프
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * HTML 이스케이프
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 메시지의 북마크 UI 업데이트
 */
function updateBookmarkUI(messageId) {
    const bookmark = findBookmarkByMessageId(messageId);
    const messageElement = $(`.mes[mesid="${messageId}"]`);

    if (!messageElement.length) return;

    // 북마크 리본 업데이트
    let bookmarkRibbon = messageElement.find('.msg-bookmark-ribbon');
    const bookmarkColor = bookmark?.color || '#F5d2d2';

    // 하이라이트 전용이면 북마크 표시 안함
    const isActualBookmark = bookmark && !bookmark.isHighlightOnly;

    if (isActualBookmark) {
        // 리본 표시 (상단 오른쪽)
        if (!bookmarkRibbon.length) {
            const ribbonHtml = `<div class="msg-bookmark-ribbon" title="북마크됨" style="background-color: ${bookmarkColor};"></div>`;
            messageElement.append(ribbonHtml);
        } else {
            bookmarkRibbon.css('background-color', bookmarkColor);
        }
        
        messageElement.addClass('has-bookmark');
    } else {
        bookmarkRibbon.remove();
        messageElement.removeClass('has-bookmark');
    }
}

/**
 * 모든 메시지에 북마크 UI 업데이트
 */
function updateAllBookmarkUI() {
    const data = getBookmarkData();
    $('.mes').each(function() {
        const mesId = parseInt($(this).attr('mesid'));
        updateBookmarkUI(mesId);
        applyHighlights(mesId);
    });
}

/**
 * 북마크 패널 업데이트
 */
function updateBookmarkPanel() {
    const panel = $('#bookmark-panel');
    if (!panel.length) return;

    const allBookmarks = getAllBookmarkData();
    const currentChatId = getChatId();
    const showAllChats = $('#bookmark-show-all').is(':checked');
    const list = panel.find('.bookmark-list');
    list.empty();

    let totalBookmarks = 0;

    // 채팅별로 북마크 표시
    for (const [chatId, chatData] of Object.entries(allBookmarks)) {
        if (!chatData.bookmarks || chatData.bookmarks.length === 0) continue;
        if (!showAllChats && chatId !== currentChatId) continue;

        const isCurrentChat = chatId === currentChatId;
        totalBookmarks += chatData.bookmarks.length;

        // 채팅방 헤더
        const chatHeaderHtml = `
            <div class="bookmark-chat-header ${isCurrentChat ? 'current-chat' : ''}" data-chat-id="${chatId}">
                <i class="fa-solid fa-${isCurrentChat ? 'comment' : 'comments'}"></i>
                <span class="chat-name">${escapeHtml(chatData.chatName || 'Unknown Chat')}</span>
                <span class="bookmark-count">(${chatData.bookmarks.length})</span>
                ${!isCurrentChat ? '<span class="other-chat-badge">다른 채팅</span>' : ''}
            </div>
        `;
        list.append(chatHeaderHtml);

        // 메시지 ID 순으로 정렬
        const sortedBookmarks = [...chatData.bookmarks].sort((a, b) => a.messageId - b.messageId);

        for (const bookmark of sortedBookmarks) {
            // 현재 채팅인 경우 실제 메시지 정보 사용
            let preview = '';
            let messageName = 'Unknown';

            if (isCurrentChat && chat[bookmark.messageId]) {
                const message = chat[bookmark.messageId];
                preview = (message.mes || '').substring(0, 50) + '...';
                messageName = message.name || 'Unknown';
            } else {
                preview = bookmark.preview || '(채팅을 열어서 확인하세요)';
                messageName = bookmark.messageName || 'Unknown';
            }

            const highlightCount = bookmark.highlights ? bookmark.highlights.length : 0;
            const bookmarkColor = bookmark.color || '#F5d2d2';

            const itemHtml = `
                <div class="bookmark-item ${isCurrentChat ? '' : 'other-chat-item'}" 
                     data-message-id="${bookmark.messageId}" 
                     data-chat-id="${chatId}">
                    <div class="bookmark-item-header">
                        <span class="bookmark-color-dot" style="background-color: ${bookmarkColor};"></span>
                        <span class="bookmark-msg-id">#${bookmark.messageId}</span>
                        <span class="bookmark-name">${escapeHtml(messageName)}</span>
                        ${highlightCount > 0 ? `<span class="highlight-count">${highlightCount} 하이라이트</span>` : ''}
                    </div>
                    <div class="bookmark-preview">${escapeHtml(preview)}</div>
                    ${bookmark.note ? `<div class="bookmark-note">${escapeHtml(bookmark.note)}</div>` : ''}
                    <div class="bookmark-actions">
                        ${isCurrentChat ? '<button class="bookmark-goto menu_button" title="이동"><i class="fa-solid fa-arrow-right"></i></button>' : ''}
                        <button class="bookmark-edit menu_button" title="메모 편집"><i class="fa-solid fa-pen"></i></button>
                        <button class="bookmark-delete menu_button" title="삭제"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `;
            list.append(itemHtml);
        }
    }

    if (totalBookmarks === 0) {
        list.html('<div class="bookmark-empty">북마크가 없습니다</div>');
    }
}

/**
 * 북마크 패널 토글
 */
function toggleBookmarkPanel() {
    let panel = $('#bookmark-panel');

    if (panel.length) {
        panel.toggle();
    } else {
        createBookmarkPanel();
    }
}

/**
 * 북마크 패널 생성
 */
function createBookmarkPanel() {
    const panelHtml = `
        <div id="bookmark-panel" class="bookmark-panel">
            <div class="bookmark-panel-header">
                <h3><i class="fa-solid fa-bookmark"></i> 북마크 목록</h3>
                <button id="bookmark-panel-close" class="menu_button"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="bookmark-panel-controls">
                <label class="checkbox_label">
                    <input type="checkbox" id="bookmark-show-all" checked>
                    <span>모든 채팅방 보기</span>
                </label>
            </div>
            <div class="bookmark-list"></div>
        </div>
    `;

    $('body').append(panelHtml);
    updateBookmarkPanel();

    // 패널 닫기 이벤트
    $('#bookmark-panel-close').on('click', () => {
        $('#bookmark-panel').hide();
    });

    // 모든 채팅 보기 토글
    $('#bookmark-show-all').on('change', () => {
        updateBookmarkPanel();
    });

    // 북마크 아이템 이벤트
    $(document).on('click', '.bookmark-item .bookmark-goto', function(e) {
        e.stopPropagation();
        const messageId = $(this).closest('.bookmark-item').data('message-id');
        scrollToMessage(messageId);
    });

    $(document).on('click', '.bookmark-item .bookmark-edit', function(e) {
        e.stopPropagation();
        const item = $(this).closest('.bookmark-item');
        const messageId = item.data('message-id');
        const chatId = item.data('chat-id');
        editBookmarkNoteGlobal(chatId, messageId);
    });

    $(document).on('click', '.bookmark-item .bookmark-delete', function(e) {
        e.stopPropagation();
        const item = $(this).closest('.bookmark-item');
        const messageId = item.data('message-id');
        const chatId = item.data('chat-id');
        removeBookmarkGlobal(chatId, messageId);
    });

    $(document).on('click', '.bookmark-item', async function() {
        const chatId = $(this).data('chat-id');
        const messageId = $(this).data('message-id');
        const currentChatId = getChatId();
        
        if (chatId === currentChatId) {
            scrollToMessage(messageId);
        } else {
            // 다른 채팅방으로 이동
            await navigateToBookmark(chatId, messageId);
        }
    });
}

/**
 * 전역 북마크 메모 편집
 */
async function editBookmarkNoteGlobal(chatId, messageId) {
    const allBookmarks = getAllBookmarkData();
    const chatData = allBookmarks[chatId];
    if (!chatData) return;

    const bookmark = chatData.bookmarks.find(b => b.messageId === messageId);
    const currentNote = bookmark ? bookmark.note : '';
    const currentColor = bookmark ? bookmark.color : '#F5d2d2';

    // 색상 및 메모 선택 팝업
    const result = await showBookmarkEditPopup(currentNote, currentColor);

    if (result !== null && bookmark) {
        bookmark.note = result.note;
        bookmark.color = result.color;
        bookmark.updatedAt = Date.now();
        saveBookmarkData();
        
        // 현재 채팅인 경우 UI 업데이트
        if (chatId === getChatId()) {
            updateBookmarkUI(messageId);
        }
        
        updateBookmarkPanel();
    }
}

/**
 * 전역 북마크 삭제
 */
function removeBookmarkGlobal(chatId, messageId) {
    const allBookmarks = getAllBookmarkData();
    const chatData = allBookmarks[chatId];
    if (!chatData) return;

    const index = chatData.bookmarks.findIndex(b => b.messageId === messageId);
    if (index !== -1) {
        chatData.bookmarks.splice(index, 1);
        
        // 북마크가 없으면 채팅 데이터도 삭제
        if (chatData.bookmarks.length === 0) {
            delete allBookmarks[chatId];
        }
        
        saveBookmarkData();
        
        // 현재 채팅인 경우 UI 업데이트
        if (chatId === getChatId()) {
            updateBookmarkUI(messageId);
        }
        
        updateBookmarkPanel();
        toastr.success('북마크가 삭제되었습니다');
    }
}

/**
 * 메시지로 스크롤
 */
function scrollToMessage(messageId) {
    const messageElement = $(`.mes[mesid="${messageId}"]`);
    if (messageElement.length) {
        messageElement[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        messageElement.addClass('bookmark-highlight-flash');
        setTimeout(() => messageElement.removeClass('bookmark-highlight-flash'), 2000);
    }
}

/**
 * 다른 채팅방의 북마크로 이동
 */
async function navigateToBookmark(chatId, messageId) {
    const allBookmarks = getAllBookmarkData();
    const chatData = allBookmarks[chatId];
    
    if (!chatData) {
        toastr.error('북마크 정보를 찾을 수 없습니다');
        return;
    }

    try {
        // 그룹 채팅인 경우
        if (chatData.groupId) {
            toastr.info('그룹 채팅으로 이동 중...');
            // 그룹 채팅은 현재 자동 이동 미지원
            toastr.warning('그룹 채팅은 직접 열어주세요');
            return;
        }

        // 캐릭터 ID 확인
        const characterId = chatData.characterId;
        if (characterId === undefined || characterId === null) {
            toastr.error('캐릭터 정보를 찾을 수 없습니다');
            return;
        }

        toastr.info(`${chatData.chatName} 채팅으로 이동 중...`);
        
        // 캐릭터 선택 및 채팅 열기
        await selectCharacterById(characterId);
        
        // 특정 채팅 파일이 있으면 해당 채팅으로 이동
        if (chatData.chatFile && characters[characterId]?.chat !== chatData.chatFile) {
            await openCharacterChat(chatData.chatFile);
        }

        // 채팅이 로드될 때까지 대기 후 메시지로 스크롤
        setTimeout(() => {
            scrollToMessage(messageId);
        }, 500);
        
    } catch (error) {
        console.error('북마크 이동 실패:', error);
        toastr.error('채팅방으로 이동하는데 실패했습니다');
    }
}

/**
 * 북마크 메모 편집 (색상 선택 없이 메모만)
 */
async function editBookmarkNote(messageId) {
    const bookmark = findBookmarkByMessageId(messageId);
    const currentNote = bookmark ? bookmark.note : '';
    // 기존 색상 유지, 없으면 설정의 기본 색상 사용
    const color = bookmark?.color || extension_settings[MODULE_NAME].defaultBookmarkColor || '#F5d2d2';

    const newNote = await callGenericPopup(
        '북마크 메모를 입력하세요 (선택사항):',
        POPUP_TYPE.INPUT,
        currentNote,
        { rows: 4 }
    );

    if (newNote !== null) {
        addBookmark(messageId, newNote, color);
        toastr.success('북마크가 저장되었습니다');
    }
}

/**
 * 하이라이트 메모 편집
 */
async function editHighlightNote(messageId, highlightId) {
    const bookmark = findBookmarkByMessageId(messageId);
    if (!bookmark) return;

    const highlight = bookmark.highlights.find(h => h.id === highlightId);
    if (!highlight) return;

    const newNote = await callGenericPopup(
        '하이라이트 메모를 입력하세요:',
        POPUP_TYPE.INPUT,
        highlight.note || '',
        { rows: 4 }
    );

    if (newNote !== null) {
        highlight.note = newNote;
        saveBookmarkData();
        applyHighlights(messageId);
    }
}

/**
 * 선택한 텍스트 하이라이트 (색상을 지정하지 않으면 설정의 기본 색상 사용)
 */
async function highlightSelection(color = null) {
    // 색상이 지정되지 않으면 설정에서 기본 색상 사용
    const highlightColor = color || extension_settings[MODULE_NAME].defaultHighlightColor || '#F5d2d2';
    
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) {
        toastr.warning('하이라이트할 텍스트를 선택해주세요');
        return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();

    if (!selectedText) {
        toastr.warning('하이라이트할 텍스트를 선택해주세요');
        return;
    }

    // 선택이 메시지 내에 있는지 확인
    const mesText = $(range.commonAncestorContainer).closest('.mes_text');
    if (!mesText.length) {
        toastr.warning('채팅 메시지 내의 텍스트만 하이라이트할 수 있습니다');
        return;
    }

    const messageElement = mesText.closest('.mes');
    const messageId = parseInt(messageElement.attr('mesid'));

    // 메모 입력 받기
    const note = await callGenericPopup(
        `"${selectedText.substring(0, 30)}${selectedText.length > 30 ? '...' : ''}" 에 대한 메모 (선택사항):`,
        POPUP_TYPE.INPUT,
        '',
        { rows: 2 }
    );

    if (note === null) return; // 취소됨

    addHighlight(messageId, selectedText, highlightColor, 0, 0, note);
    selection.removeAllRanges();
    toastr.success('하이라이트가 추가되었습니다');
}

/**
 * 색상 선택 팝업 표시
 */
async function showColorPicker() {
    const settings = extension_settings[MODULE_NAME];
    const colors = settings.highlightColors;

    const colorButtons = colors.map(c =>
        `<button class="color-pick-btn menu_button" data-color="${c.color}" style="background-color: ${c.color}; min-width: 60px;">${c.name}</button>`
    ).join('');

    const html = `
        <div class="color-picker-popup">
            <p>하이라이트 색상을 선택하세요:</p>
            <div class="color-buttons" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;">
                ${colorButtons}
            </div>
        </div>
    `;

    return new Promise((resolve) => {
        const popup = $(html);
        popup.find('.color-pick-btn').on('click', function() {
            resolve($(this).data('color'));
        });
        callGenericPopup(popup, POPUP_TYPE.TEXT, '', { okButton: '취소' }).then(() => resolve(null));
    });
}

/**
 * 컨텍스트 메뉴에 항목 추가
 */
function setupContextMenu() {
    // 메시지 블록에서 우클릭 시 커스텀 메뉴 (데스크톱)
    $(document).on('contextmenu', '.mes_text', function(e) {
        const selection = window.getSelection();
        if (selection.isCollapsed) return; // 선택된 텍스트가 없으면 기본 메뉴 사용

        e.preventDefault();

        const messageElement = $(this).closest('.mes');
        const messageId = parseInt(messageElement.attr('mesid'));

        showHighlightContextMenu(e.pageX, e.pageY, messageId);
    });

    // 모바일용: 텍스트 선택 변경 감지
    setupMobileSelectionHandler();
}

/**
 * 모바일 텍스트 선택 핸들러
 */
function setupMobileSelectionHandler() {
    let selectionTimeout = null;

    // 선택 변경 감지
    document.addEventListener('selectionchange', () => {
        // 기존 타임아웃 취소
        if (selectionTimeout) {
            clearTimeout(selectionTimeout);
        }

        // 플로팅 툴바 숨기기
        hideFloatingToolbar();

        // 약간의 딜레이 후 선택 확인 (선택이 완료될 때까지 대기)
        selectionTimeout = setTimeout(() => {
            const selection = window.getSelection();
            if (selection.isCollapsed || !selection.toString().trim()) {
                return;
            }

            // 선택이 메시지 내에 있는지 확인
            const range = selection.getRangeAt(0);
            const mesText = $(range.commonAncestorContainer).closest('.mes_text');
            if (!mesText.length) {
                return;
            }

            // 플로팅 툴바 표시
            showFloatingToolbar(selection, mesText);
        }, 300);
    });

    // 터치 시작 시 툴바 숨기기 (선택 외 영역 터치)
    $(document).on('touchstart', function(e) {
        if (!$(e.target).closest('.highlight-floating-toolbar').length &&
            !$(e.target).closest('.highlight-context-menu').length) {
            // 약간의 딜레이 후 숨기기 (새 선택을 위해)
            setTimeout(() => {
                const selection = window.getSelection();
                if (selection.isCollapsed) {
                    hideFloatingToolbar();
                }
            }, 100);
        }
    });
}

/**
 * 플로팅 툴바 표시 (하이라이트 색상 선택 버튼들)
 */
function showFloatingToolbar(selection, mesText) {
    hideFloatingToolbar();

    const messageElement = mesText.closest('.mes');
    const messageId = parseInt(messageElement.attr('mesid'));

    const settings = extension_settings[MODULE_NAME];
    const highlightColors = settings.highlightColors || defaultSettings.highlightColors;
    const bookmarkColor = settings.defaultBookmarkColor || '#F5d2d2';

    // 선택 영역의 위치 계산
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // 색상 버튼들 생성
    const colorButtons = highlightColors.map(c => 
        `<button class="floating-color-btn" data-color="${c.color}" title="${c.name}" style="background-color: ${c.color};"></button>`
    ).join('');

    const toolbarHtml = `
        <div class="highlight-floating-toolbar" data-message-id="${messageId}">
            <div class="floating-toolbar-colors">
                ${colorButtons}
            </div>
        </div>
    `;

    $('body').append(toolbarHtml);

    const toolbar = $('.highlight-floating-toolbar');
    const toolbarWidth = toolbar.outerWidth();
    const toolbarHeight = toolbar.outerHeight();

    // 위치 계산 (선택 영역 위에 표시)
    let left = rect.left + (rect.width / 2) - (toolbarWidth / 2);
    let top = rect.top - toolbarHeight - 10 + window.scrollY;

    // 화면 밖으로 나가지 않도록 조정
    if (left < 10) left = 10;
    if (left + toolbarWidth > window.innerWidth - 10) {
        left = window.innerWidth - toolbarWidth - 10;
    }
    if (top < 10) {
        top = rect.bottom + 10 + window.scrollY; // 아래에 표시
    }

    toolbar.css({
        left: left + 'px',
        top: top + 'px'
    });

    // 하이라이트 색상 버튼 클릭
    toolbar.find('.floating-color-btn').on('click', async function() {
        const color = $(this).data('color');
        await highlightSelection(color);
        hideFloatingToolbar();
    });
}

/**
 * 플로팅 툴바 숨기기
 */
function hideFloatingToolbar() {
    $('.highlight-floating-toolbar').remove();
}

/**
 * 하이라이트 컨텍스트 메뉴 표시 (색상 선택 옵션)
 */
function showHighlightContextMenu(x, y, messageId) {
    // 기존 메뉴 제거
    $('.highlight-context-menu').remove();

    const settings = extension_settings[MODULE_NAME];
    const highlightColors = settings.highlightColors || defaultSettings.highlightColors;
    const bookmarkColor = settings.defaultBookmarkColor || '#F5d2d2';

    const colorItems = highlightColors.map(c =>
        `<div class="context-menu-item highlight-color-item" data-color="${c.color}">
            <span class="color-dot" style="background-color: ${c.color};"></span>
            ${c.name} 하이라이트
        </div>`
    ).join('');

    const menuHtml = `
        <div class="highlight-context-menu" style="position: fixed; left: ${x}px; top: ${y}px;">
            ${colorItems}
        </div>
    `;

    $('body').append(menuHtml);

    // 메뉴 이벤트
    $('.highlight-color-item').on('click', async function() {
        const color = $(this).data('color');
        await highlightSelection(color);
        $('.highlight-context-menu').remove();
    });

    // 클릭 시 메뉴 닫기
    $(document).one('click', function() {
        $('.highlight-context-menu').remove();
    });
}

/**
 * 메시지 버튼 추가
 */
function addMessageButtons() {
    // 기존 버튼 제거 후 재추가
    $('.mes_bookmark_btn').remove();

    $('.mes').each(function() {
        const mesId = parseInt($(this).attr('mesid'));
        const bookmark = findBookmarkByMessageId(mesId);
        const isBookmarked = !!bookmark;

        const buttonHtml = `
            <div class="mes_bookmark_btn mes_button fa-solid fa-bookmark ${isBookmarked ? 'bookmarked' : ''}"
                 title="${isBookmarked ? '북마크 편집/삭제' : '북마크 추가'}"></div>
        `;

        // extraMesButtons 영역에 추가
        const extraButtons = $(this).find('.extraMesButtons');
        if (extraButtons.length && !extraButtons.find('.mes_bookmark_btn').length) {
            extraButtons.prepend(buttonHtml);
        }
    });
}

/**
 * 메시지 버튼 클릭 핸들러
 */
function setupMessageButtonHandlers() {
    $(document).on('click', '.mes_bookmark_btn', async function(e) {
        e.stopPropagation();
        const messageElement = $(this).closest('.mes');
        const messageId = parseInt(messageElement.attr('mesid'));
        const bookmark = findBookmarkByMessageId(messageId);

        if (bookmark) {
            // 북마크가 있으면 편집/삭제 선택
            const result = await callGenericPopup(
                '북마크 작업을 선택하세요',
                POPUP_TYPE.TEXT,
                '',
                {
                    okButton: '메모 편집',
                    cancelButton: '삭제',
                    customButtons: ['취소']
                }
            );

            if (result === 1) { // 메모 편집
                await editBookmarkNote(messageId);
            } else if (result === 0) { // 삭제
                removeBookmark(messageId);
                toastr.success('북마크가 삭제되었습니다');
            }
        } else {
            // 북마크 추가
            await editBookmarkNote(messageId);
        }
    });
}

/**
 * 하이라이트 클릭 핸들러
 */
function setupHighlightClickHandlers() {
    $(document).on('click', '.msg-highlight', async function(e) {
        e.stopPropagation();
        const highlightId = $(this).data('highlight-id');
        const messageElement = $(this).closest('.mes');
        const messageId = parseInt(messageElement.attr('mesid'));

        const result = await callGenericPopup(
            '하이라이트 작업을 선택하세요',
            POPUP_TYPE.TEXT,
            '',
            {
                okButton: '메모 편집',
                cancelButton: '삭제',
                customButtons: ['취소']
            }
        );

        if (result === 1) { // 메모 편집
            await editHighlightNote(messageId, highlightId);
        } else if (result === 0) { // 삭제
            removeHighlight(messageId, highlightId);
            toastr.success('하이라이트가 삭제되었습니다');
        }
    });
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 채팅 변경 시 UI 업데이트
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(() => {
            updateAllBookmarkUI();
            addMessageButtons();
        }, 500);
    });

    // 메시지 추가 시 버튼 추가
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        setTimeout(addMessageButtons, 100);
    });

    eventSource.on(event_types.MESSAGE_SENT, () => {
        setTimeout(addMessageButtons, 100);
    });

    // 채팅 로드 완료 시
    eventSource.on(event_types.CHATLOADED, () => {
        setTimeout(() => {
            updateAllBookmarkUI();
            addMessageButtons();
        }, 500);
    });
}

/**
 * 설정 패널 HTML
 */
async function renderSettings() {
    const settings = extension_settings[MODULE_NAME];
    const bookmarkColors = settings.bookmarkColors || defaultSettings.bookmarkColors;
    const highlightColors = settings.highlightColors || defaultSettings.highlightColors;
    const currentBookmarkColor = settings.defaultBookmarkColor || '#F5d2d2';
    const currentHighlightColor = settings.defaultHighlightColor || '#F5d2d2';

    const bookmarkColorButtons = bookmarkColors.map(c =>
        `<button type="button" class="settings-color-btn bookmark-color-option ${c.color === currentBookmarkColor ? 'selected' : ''}" 
                 data-color="${c.color}" 
                 style="background-color: ${c.color};" 
                 title="${c.name}"></button>`
    ).join('');

    const highlightColorButtons = highlightColors.map(c =>
        `<button type="button" class="settings-color-btn highlight-color-option ${c.color === currentHighlightColor ? 'selected' : ''}" 
                 data-color="${c.color}" 
                 style="background-color: ${c.color};" 
                 title="${c.name}"></button>`
    ).join('');

    const settingsHtml = `
        <div class="message-bookmarks-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>📑 Message Bookmarks</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="message-bookmarks-controls">
                        <label class="checkbox_label">
                            <input type="checkbox" id="mb-enabled" ${settings.enabled ? 'checked' : ''}>
                            <span>활성화</span>
                        </label>

                        <div class="mb-panel-buttons">
                            <button id="mb-show-panel" class="menu_button">
                                <i class="fa-solid fa-bookmark"></i> 북마크 패널
                            </button>
                            <button id="mb-show-highlight-panel" class="menu_button">
                                <i class="fa-solid fa-highlighter"></i> 하이라이트 패널
                            </button>
                        </div>

                        <hr>

                        <div class="mb-color-settings">
                            <div class="mb-color-row">
                                <label><i class="fa-solid fa-bookmark"></i> 북마크 색상:</label>
                                <div class="mb-color-picker">
                                    ${bookmarkColorButtons}
                                </div>
                            </div>
                        </div>

                        <hr>

                        <div class="mb-help">
                            <b>사용 방법:</b>
                            <ul>
                                <li>메시지에서 텍스트를 선택하고 우클릭하여 하이라이트 추가</li>
                                <li>메시지의 북마크 버튼(🔖)을 클릭하여 북마크 추가</li>
                                <li>북마크 패널에서 모든 북마크 관리</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings2').append(settingsHtml);

    // 활성화 설정
    $('#mb-enabled').on('change', function() {
        extension_settings[MODULE_NAME].enabled = $(this).is(':checked');
        saveSettingsDebounced();
    });

    // 북마크 색상 선택
    $('.bookmark-color-option').on('click', function() {
        $('.bookmark-color-option').removeClass('selected');
        $(this).addClass('selected');
        extension_settings[MODULE_NAME].defaultBookmarkColor = $(this).data('color');
        saveSettingsDebounced();
        toastr.success('북마크 색상이 변경되었습니다');
    });

    $('#mb-show-panel').on('click', toggleBookmarkPanel);
    $('#mb-show-highlight-panel').on('click', toggleHighlightPanel);
}

/**
 * 하이라이트 패널 토글
 */
function toggleHighlightPanel() {
    let panel = $('#highlight-panel');

    if (panel.length) {
        panel.toggle();
        if (panel.is(':visible')) {
            updateHighlightPanel();
        }
    } else {
        createHighlightPanel();
    }
}

/**
 * 하이라이트 패널 생성
 */
function createHighlightPanel() {
    const panelHtml = `
        <div id="highlight-panel" class="highlight-panel">
            <div class="highlight-panel-header">
                <h3><i class="fa-solid fa-highlighter"></i> 하이라이트 목록</h3>
                <button id="highlight-panel-close" class="menu_button"><i class="fa-solid fa-times"></i></button>
            </div>
            <div class="highlight-panel-controls">
                <label class="checkbox_label">
                    <input type="checkbox" id="highlight-show-all" checked>
                    <span>모든 채팅방 보기</span>
                </label>
            </div>
            <div class="highlight-list"></div>
        </div>
    `;

    $('body').append(panelHtml);
    updateHighlightPanel();

    // 패널 닫기 이벤트
    $('#highlight-panel-close').on('click', () => {
        $('#highlight-panel').hide();
    });

    // 모든 채팅 보기 토글
    $('#highlight-show-all').on('change', () => {
        updateHighlightPanel();
    });

    // 하이라이트 아이템 클릭 이벤트
    $(document).on('click', '.highlight-list-item', async function() {
        const chatId = $(this).data('chat-id');
        const messageId = $(this).data('message-id');
        const currentChatId = getChatId();
        
        if (chatId === currentChatId) {
            scrollToMessage(messageId);
        } else {
            await navigateToBookmark(chatId, messageId);
        }
    });

    // 하이라이트 삭제 이벤트
    $(document).on('click', '.highlight-list-item .highlight-delete-btn', function(e) {
        e.stopPropagation();
        const item = $(this).closest('.highlight-list-item');
        const chatId = item.data('chat-id');
        const messageId = item.data('message-id');
        const highlightId = item.data('highlight-id');
        removeHighlightGlobal(chatId, messageId, highlightId);
    });
}

/**
 * 하이라이트 패널 업데이트
 */
function updateHighlightPanel() {
    const panel = $('#highlight-panel');
    if (!panel.length) return;

    const allBookmarks = getAllBookmarkData();
    const currentChatId = getChatId();
    const showAll = $('#highlight-show-all').is(':checked');
    const list = panel.find('.highlight-list');
    list.empty();

    let totalHighlights = 0;

    // 현재 채팅 먼저, 그 다음 다른 채팅들
    const sortedChatIds = Object.keys(allBookmarks).sort((a, b) => {
        if (a === currentChatId) return -1;
        if (b === currentChatId) return 1;
        return 0;
    });

    for (const chatId of sortedChatIds) {
        const chatData = allBookmarks[chatId];
        const isCurrentChat = chatId === currentChatId;
        
        if (!showAll && !isCurrentChat) continue;

        // 하이라이트가 있는 북마크만 필터
        const bookmarksWithHighlights = chatData.bookmarks.filter(b => b.highlights && b.highlights.length > 0);
        if (bookmarksWithHighlights.length === 0) continue;

        // 채팅방 헤더
        const chatHighlightCount = bookmarksWithHighlights.reduce((sum, b) => sum + b.highlights.length, 0);
        totalHighlights += chatHighlightCount;
        
        list.append(`
            <div class="highlight-chat-header ${isCurrentChat ? 'current-chat' : ''}">
                <i class="fa-solid fa-comments"></i>
                <span class="chat-name">${escapeHtml(chatData.chatName || 'Unknown Chat')}</span>
                <span class="highlight-count-badge">${chatHighlightCount}</span>
                ${!isCurrentChat ? '<span class="other-chat-badge">다른 채팅</span>' : ''}
            </div>
        `);

        for (const bookmark of bookmarksWithHighlights) {
            for (const highlight of bookmark.highlights) {
                const itemHtml = `
                    <div class="highlight-list-item ${isCurrentChat ? '' : 'other-chat-item'}" 
                         data-message-id="${bookmark.messageId}" 
                         data-chat-id="${chatId}"
                         data-highlight-id="${highlight.id}">
                        <div class="highlight-list-item-header">
                            <span class="highlight-color-indicator" style="background-color: ${highlight.color};"></span>
                            <span class="highlight-msg-id">#${bookmark.messageId}</span>
                            <span class="highlight-sender">${escapeHtml(bookmark.messageName || 'Unknown')}</span>
                        </div>
                        <div class="highlight-text-preview" style="border-left-color: ${highlight.color};">
                            "${escapeHtml(highlight.text)}"
                        </div>
                        ${highlight.note ? `<div class="highlight-note">${escapeHtml(highlight.note)}</div>` : ''}
                        <div class="highlight-list-actions">
                            <button class="highlight-delete-btn menu_button" title="삭제"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `;
                list.append(itemHtml);
            }
        }
    }

    if (totalHighlights === 0) {
        list.html('<div class="highlight-empty">하이라이트가 없습니다</div>');
    }
}

/**
 * 전역 하이라이트 삭제
 */
function removeHighlightGlobal(chatId, messageId, highlightId) {
    const allBookmarks = getAllBookmarkData();
    const chatData = allBookmarks[chatId];
    if (!chatData) return;

    const bookmark = chatData.bookmarks.find(b => b.messageId === messageId);
    if (!bookmark || !bookmark.highlights) return;

    const index = bookmark.highlights.findIndex(h => h.id === highlightId);
    if (index !== -1) {
        bookmark.highlights.splice(index, 1);
        saveBookmarkData();
        
        // 현재 채팅인 경우 UI 업데이트
        if (chatId === getChatId()) {
            applyHighlights(messageId);
        }
        
        updateHighlightPanel();
        toastr.success('하이라이트가 삭제되었습니다');
    }
}

/**
 * 초기화
 */
jQuery(async () => {
    loadSettings();

    await renderSettings();

    setupContextMenu();
    setupMessageButtonHandlers();
    setupHighlightClickHandlers();
    setupEventListeners();

    // 초기 UI 업데이트
    setTimeout(() => {
        updateAllBookmarkUI();
        addMessageButtons();
        createBookmarkPanel();
        $('#bookmark-panel').hide();
        createHighlightPanel();
        $('#highlight-panel').hide();
    }, 1000);

    console.log(`[${MODULE_NAME}] Extension loaded`);
});
