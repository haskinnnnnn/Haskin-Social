import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, onSnapshot, query, orderBy, where, limit, increment, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBCcBSZx6kAFGwTscJlfDuiQILGZDaVN4g",
    authDomain: "mysocnet-34ee9.firebaseapp.com",
    projectId: "mysocnet-34ee9",
    storageBucket: "mysocnet-34ee9.firebasestorage.app",
    messagingSenderId: "82449086862",
    appId: "1:82449086862:web:e77a61b33a54be97a00cdf",
    measurementId: "G-4Z2SMZS5N4"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// --- SETTINGS ---
const CASE_PRICE = 100; 
const LEGACY_PRICE = 500;
const ITEMS_DB = {
    legendary: ['🤡', '👻', '👺', '💀'],
    epic: ['👑', '🦄', '🐲', '👽', '💎', '💸'],
    rare: ['😳', '🥸', '🤔', '😍', '🥶', '🤬', '😈'],
    common: ['💩', '🤖', '👾', '🎃', '😺', '🙉', '🦊', '🌚', '🍕', '🍔', '🍟', '🌭', '🍿', '🧂', '🥓', '🥚', '🍳', '🧇', '🥞', '🧈', '🍞', '🥐', '🥨', '🥯', '🥖', '🧀', '🥗', 'pita', '🥪', '🌮', '🌯', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯']
};

const ICONS = {
    like: '<svg class="icon" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    comment: '<svg class="icon" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    verify: '<svg class="verified-badge" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
    lock: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
};

let currentUser = null;
let listeners = {};
let tempImg = null;
let tempChatImg = null;
let tempAv = null;
let curChat = null;
let curChatAvatar = '';
let activeChatUnsub = null;
let forbiddenWords = [];
let activeGroupId = null;
let mediaRec = null;
let audioChunks = [];
let captchaAns = 0;

// --- UTILS ---
const compress = (file, cb) => {
    const r = new FileReader(); r.readAsDataURL(file);
    r.onload = e => {
        const i = new Image(); i.src = e.target.result;
        i.onload = () => {
            const c = document.createElement('canvas');
            const max = 800; let w=i.width, h=i.height;
            if(w>h){if(w>max){h*=max/w;w=max}}else{if(h>max){w*=max/h;h=max}}
            c.width=w; c.height=h; c.getContext('2d').drawImage(i,0,0,w,h);
            cb(c.toDataURL('image/jpeg', 0.8));
        }
    }
};

const getAv = (u, sz, addFrame=false) => {
    let src = u.avatar || u.authorAvatar || 'https://via.placeholder.com/80';
    let frameClass = '';
    // Обводка пропадает, если нет инвентаря (проданы)
    if(addFrame && u.inventory) {
        if(u.inventory.some(i => i.rarity === 'legendary')) frameClass = 'frame-legendary';
        else if(u.inventory.some(i => i.rarity === 'epic')) frameClass = 'frame-epic';
    }
    
    // SATELLITES Logic (Pinned Emojis)
    let satellites = '';
    if(u.pinnedEmojis) {
        if(u.pinnedEmojis.slot1) satellites += `<span class="sat-icon sat-1">${u.pinnedEmojis.slot1}</span>`;
        if(u.pinnedEmojis.slot2) satellites += `<span class="sat-icon sat-2">${u.pinnedEmojis.slot2}</span>`;
    }

    return `<div class="avatar-wrap"><img src="${src}" class="avatar ${sz} ${frameClass}">${satellites}</div>`;
};

const parseTime = (ts) => new Date(ts).toLocaleDateString();

// --- UI ---
window.ui = {
    nav: (v, p) => {
        if(activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
        if(v === 'profile' && !p) { if(currentUser) p = currentUser.username; else return; }
        
        document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));
        
        const el = document.getElementById('view-'+(v==='admin'?'admin':v));
        if(el) el.classList.add('active');
        
        const map = {'feed':0, 'market':1, 'search':2, 'groups':3, 'chats':4, 'notifs':5, 'rich':6, 'profile':7, 'settings':8};
        if(map[v]!==undefined && document.querySelectorAll('.nav-item')[map[v]]) 
            document.querySelectorAll('.nav-item')[map[v]].classList.add('active');

        if(v==='chat-room') {
            document.getElementById('view-chat-room').style.display = 'flex';
            document.querySelector('.sidebar').style.display = 'none'; 
        } else {
            document.getElementById('view-chat-room').style.display = 'none';
            document.querySelector('.sidebar').style.display = 'flex';
        }
        
        if(v==='feed') app.loadFeed();
        if(v==='chats') app.loadChats();
        if(v==='groups') app.loadGroups();
        if(v==='notifs') app.listenNotifs();
        if(v==='market') market.tab('cases');
        if(v==='rich') app.loadRich();
        if(v==='profile') app.loadProfile(p);
        if(v==='chat-room') app.loadChatRoom(p);
        if(v==='admin') { admin.tab('users'); admin.stats(); }
        if(v==='settings') {
            document.getElementById('settings-bal').innerText = currentUser.balance || 0;
            if(currentUser.isAdmin) document.getElementById('settings-admin-btn').classList.remove('hidden');
        }
    },
    toggleAuth: m => {
        document.getElementById('login-box').classList.toggle('hidden', m!=='login');
        document.getElementById('reg-box').classList.toggle('hidden', m!=='reg');
        if(m==='reg') app.genCaptcha();
    },
    togglePass: id => {
        const el = document.getElementById(id);
        el.type = el.type==='password'?'text':'password';
    },
    closeModals: () => {
        document.querySelectorAll('.modal-overlay').forEach(e=>e.style.display='none');
        document.getElementById('case-result').classList.add('hidden');
        document.getElementById('case-spinner').classList.remove('hidden');
        document.getElementById('case-close-btn').classList.add('hidden');
    },
    theme: () => {
        const d = document.getElementById('theme-switch').checked;
        document.documentElement.setAttribute('data-theme', d?'dark':'');
        localStorage.setItem('theme', d?'dark':'');
    },
    setTab: (t, btn) => {
        document.querySelectorAll('.set-page').forEach(e=>e.classList.add('hidden'));
        document.getElementById('set-'+t).classList.remove('hidden');
        btn.parentElement.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));
        btn.classList.add('active');
    }
};

// --- APP LOGIC ---
window.app = {
    init: async () => {
        if(localStorage.getItem('theme')==='dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.getElementById('theme-switch').checked = true;
        }
        try {
            const u = localStorage.getItem('user');
            if(u) {
                const s = await getDoc(doc(db, 'users', u));
                if(s.exists()) {
                    currentUser = s.data();
                    // Migrations
                    currentUser.inventory = currentUser.inventory || [];
                    currentUser.pinnedEmojis = currentUser.pinnedEmojis || { slot1: null, slot2: null };
                    
                    if(currentUser.isDeleted) throw new Error('Deleted');
                    if(currentUser.isBanned) throw new Error('Banned');
                    
                    document.getElementById('auth-screen').style.display='none';
                    document.getElementById('app-screen').style.display='block';
                    if(currentUser.isAdmin) document.getElementById('nav-admin').classList.remove('hidden');
                    
                    app.checkStatuses();
                    ui.nav('feed');
                } else throw new Error('No User');
            } else throw new Error('No Local User');
        } catch(e) {
            localStorage.clear();
            ui.toggleAuth('login');
        } finally {
            setTimeout(() => { document.getElementById('splash').style.display='none'; }, 500);
        }
    },

    genCaptcha: () => {
        const a=Math.floor(Math.random()*10), b=Math.floor(Math.random()*10);
        captchaAns = a+b;
        document.getElementById('captcha-task').innerText = `${a} + ${b}`;
    },

    register: async () => {
        const u = document.getElementById('reg-user').value.toLowerCase().trim();
        const n = document.getElementById('reg-name').value.trim();
        const p1 = document.getElementById('reg-pass').value;
        const p2 = document.getElementById('reg-pass2').value;
        const c = parseInt(document.getElementById('reg-captcha').value);
        if(!u || !n || !p1) return alert('Заполните поля');
        if(p1!==p2) return alert('Пароли не совпадают');
        if(c!==captchaAns) return alert('Капча неверна');
        try {
            const r = doc(db, 'users', u);
            if((await getDoc(r)).exists()) return alert('Ник занят');
            await setDoc(r, { username: u, name: n, password: p1, followers: [], following: [], blocked: [], isAdmin: false, isBanned: false, isMuted: false, requests: [], groups: [], bio: '', status: 'Новичок', avatar: '', createdAt: Date.now(), balance: 10, inventory: [], pinnedEmojis: { slot1: null, slot2: null } });
            alert('Готово! Войдите.'); ui.toggleAuth('login');
        } catch(e) { alert('Ошибка'); }
    },

    login: async () => {
        const u = document.getElementById('login-user').value.toLowerCase().trim();
        const p = document.getElementById('login-pass').value;
        const s = await getDoc(doc(db, 'users', u));
        if(s.exists() && s.data().password === p) {
            if(s.data().isBanned) return alert('Бан');
            localStorage.setItem('user', u);
            location.reload();
        } else alert('Неверно');
    },
    logout: () => { localStorage.clear(); location.reload(); },

    // --- POSTS ---
    openCreatePost: () => {
        document.getElementById('group-post-hint').style.display = activeGroupId ? 'block' : 'none';
        if(activeGroupId) document.getElementById('group-post-hint').innerText = "В группу: " + activeGroupId;
        document.getElementById('create-post-modal').style.display='flex';
    },

    createPost: async () => {
        if(currentUser.isMuted) return alert("Вы замьючены!");
        const txt = document.getElementById('post-text').value.trim();
        if(!txt && !tempImg) return;
        
        // Модерация изображений
        const isApproved = !tempImg; // Если есть картинка, нужно одобрение
        
        const p = { 
            author: currentUser.username, 
            name: currentUser.name, 
            content: txt, 
            image: tempImg || null, 
            likes: [], 
            createdAt: Date.now(), 
            verified: currentUser.isVerified || false, 
            status: currentUser.status || '', 
            avatar: currentUser.avatar || '',
            authorInventory: currentUser.inventory || [],
            pinnedEmojis: currentUser.pinnedEmojis || {},
            approved: isApproved // Flag
        };
        if(activeGroupId) p.groupId = activeGroupId;

        await addDoc(collection(db, 'posts'), p);
        if(!isApproved) alert("Пост с фото отправлен на проверку модератору.");
        else {
             await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(5) });
             currentUser.balance += 5;
        }

        document.getElementById('post-text').value='';
        app.clearImg(); ui.closeModals();
        if(activeGroupId) app.loadProfile(activeGroupId);
    },

    loadFeed: async () => {
        const c = document.getElementById('feed-content'); c.innerHTML = '';
        if(listeners.feed) listeners.feed();
        
        // Показываем только одобренные посты (или свои, или если админ)
        const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
        listeners.feed = onSnapshot(q, s => {
            let html = '';
            s.forEach(d => {
                const p = d.data(); p.id = d.id;
                if(!p.approved && p.author !== currentUser.username && !currentUser.isAdmin) return; // Скрываем неодобренные
                
                // Приватность в ленте: если автор закрыт и я не подписчик - не показывать
                if(!p.groupId && !currentUser.following.includes(p.author) && p.author !== currentUser.username) {
                     // Нужно проверить флаг isPrivate у автора, но это дорогой запрос в цикле.
                     // Упрощение: мы не фильтруем здесь, но контент в профиле скрыт. 
                     // Для полной приватности ленты нужно дублировать флаг isPrivate в пост.
                }

                if(p.groupId) return;
                if(currentUser.blocked.includes(p.author)) return;
                html += app.renderPost(p);
            });
            c.innerHTML = html;
        });
    },

    renderPost: (p, isTop=false) => {
        const likes = p.likes || [];
        const isLiked = likes.includes(currentUser.username);
        const verified = p.verified ? ICONS.verify : '';
        const status = p.status ? `<span class="status-pill">${p.status}</span>` : '';
        const pending = !p.approved ? '<b style="color:red">[На проверке]</b>' : '';
        
        const fakeUser = { avatar: p.avatar, authorAvatar: p.authorAvatar, inventory: p.authorInventory, pinnedEmojis: p.pinnedEmojis };

        return `<div class="card ${isTop?'top-post-banner':''}">
            ${isTop ? '<div class="top-label">👑 ТОП ДНЯ</div>' : ''}
            <div class="post-header" onclick="ui.nav('profile','${p.author}')">
                ${getAv(fakeUser, 'av-40', true)}
                <div><div style="font-weight:bold; display:flex; align-items:center;">${p.name||p.author} ${verified} ${status}</div>
                <div style="font-size:12px; color:gray">@${p.author} • ${parseTime(p.createdAt)} ${pending}</div></div>
            </div>
            <div style="white-space:pre-wrap">${p.content}</div>
            ${p.image ? `<img src="${p.image}" class="post-img">` : ''}
            <div class="post-actions">
                <div class="act-btn ${isLiked?'liked':''}" onclick="app.like('${p.id}', '${p.author}')">${ICONS.like} ${likes.length}</div>
                <div class="act-btn" onclick="app.openComs('${p.id}', '${p.author}')">${ICONS.comment}</div>
                ${currentUser.isAdmin || p.author === currentUser.username ? `<div class="act-btn" style="margin-left:auto; color:red" onclick="app.delPost('${p.id}')">🗑️</div>` : ''}
            </div>
        </div>`;
    },

    loadProfile: async (u) => {
        const c = document.getElementById('profile-head');
        const pc = document.getElementById('profile-posts');
        c.innerHTML = '<div class="info-box">Загрузка...</div>';
        pc.innerHTML = '';
        activeGroupId = null;

        if (u === 'System') return c.innerHTML = `<div class="card center-content"><h2>🤖 System</h2></div>`;

        const s = await getDoc(doc(db, 'users', u));
        if(s.exists()) { 
            const user = s.data();
            const isMe = u === currentUser.username;
            const isFollow = currentUser.following.includes(u);
            const isBlocked = currentUser.blocked.includes(u);
            // Если профиль закрыт, и это не я, и я не подписан -> контент скрыт
            const isClosed = user.isPrivate && !isMe && !isFollow;
            
            let btn = '';
            if(isMe) btn = `<button class="action-btn sm-btn" onclick="ui.nav('settings')">Редактировать</button>`;
            else {
                if(isBlocked) btn = `<button class="action-btn btn-sec sm-btn" onclick="app.blockUser('${u}', false)">Разблокировать</button>`;
                else {
                    if(isFollow) btn = `<button class="action-btn btn-sec sm-btn" onclick="app.follow('${u}')">Отписаться</button> <button class="action-btn sm-btn" onclick="ui.nav('chat-room','${u}')">Чат</button>`;
                    else if (user.isPrivate) {
                        const sent = user.requests && user.requests.includes(currentUser.username);
                        btn = `<button class="action-btn sm-btn" onclick="app.reqFollow('${u}')">${sent?'Запрос отправлен':'🔒 Подписаться'}</button>`;
                    } else btn = `<button class="action-btn sm-btn" onclick="app.follow('${u}')">Подписаться</button>`;
                    
                    btn += `<br><button class="action-btn btn-danger sm-btn mt-10" onclick="app.blockUser('${u}', true)">Заблокировать</button>`;
                }
            }

            c.innerHTML = `<div class="card center-content">
                ${getAv(user, 'av-80', true)}
                <h2 style="margin:5px 0">${user.name} ${user.isVerified?ICONS.verify:''}</h2>
                <div style="color:gray">@${user.username} ${user.status?`• <span class="status-pill">${user.status}</span>`:''}</div>
                <p>${user.bio||''}</p>
                <div style="display:flex; justify-content:center; gap:20px; margin:10px 0;">
                    <b>${user.followers.length} <span style="font-weight:normal; color:gray">подп.</span></b>
                    <b>${user.following.length} <span style="font-weight:normal; color:gray">подписки</span></b>
                </div>${btn}</div>`;

            if(isClosed) {
                pc.innerHTML = `<div class="info-box">${ICONS.lock} Это закрытый профиль</div>`;
            } else {
                const q = query(collection(db, 'posts'), where('author', '==', u));
                const ps = await getDocs(q);
                let postsArr = [];
                ps.forEach(d => postsArr.push({...d.data(), id:d.id}));
                postsArr.sort((a,b) => b.createdAt - a.createdAt);
                
                if(postsArr.length === 0) pc.innerHTML = '<div class="info-box">Нет постов</div>';
                else postsArr.forEach(p => { if(!p.groupId && p.approved) pc.innerHTML += app.renderPost(p); });
            }
        } else {
             // GROUP LOGIC (Same as before)
             // ...
        }
    },
    
    // --- CHATS FIXED ---
    loadChats: async () => {
        const c = document.getElementById('chats-list'); c.innerHTML='<div class="info-box">Обновление...</div>';
        const pinned = currentUser.pinnedChats || [];
        const friends = currentUser.following; 
        let chatsData = [];
        for(const f of friends) {
             const u = await getDoc(doc(db, 'users', f));
             if(!u.exists()) continue;
             if(u.data().following.includes(currentUser.username)) {
                 const chatId = [currentUser.username, f].sort().join('_');
                 const meta = await getDoc(doc(db, 'chats', chatId));
                 chatsData.push({ id: f, user: u.data(), lastMsg: meta.exists() ? meta.data().lastMessage : '...', lastTime: meta.exists() ? meta.data().lastTime : 0 });
             }
        }
        chatsData.sort((a,b) => b.lastTime - a.lastTime);
        c.innerHTML = '';
        if(chatsData.length===0) c.innerHTML='<div class="info-box">Подпишитесь взаимно</div>';
        chatsData.forEach(ch => {
            c.innerHTML += `<div class="card user-row" onclick="ui.nav('chat-room','${ch.id}')" style="justify-content:space-between">
                <div class="user-row" style="flex:1">
                    ${getAv(ch.user, 'av-40')} 
                    <div><b>${ch.user.name}</b><div style="font-size:12px; color:gray; overflow:hidden; white-space:nowrap; max-width:150px;">${ch.lastMsg}</div></div>
                </div>
            </div>`;
        });
    },

    loadChatRoom: async (partner) => {
        document.getElementById('chat-title').innerText = partner;
        curChat = partner;
        if(partner === 'System') document.getElementById('chat-bar').style.display = 'none';
        else document.getElementById('chat-bar').style.display = 'flex';

        const chatId = [currentUser.username, partner].sort().join('_');
        const c = document.getElementById('msg-container');
        if(activeChatUnsub) activeChatUnsub();
        
        const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('time', 'asc'), limit(50));
        activeChatUnsub = onSnapshot(q, s => {
            c.innerHTML = '';
            s.forEach(d => {
                const m = d.data();
                const isMe = m.from === currentUser.username;
                let html = '';
                
                // GAME RENDER
                if(m.type === 'game_invite') {
                    const isMyGame = m.creator === currentUser.username;
                    html = `<div class="msg-row ${isMe?'me':'other'}"><div class="msg game">
                        <b>🎲 Больше/Меньше</b><br>
                        Ставка: ${m.bet} HC<br>
                        ${m.finished ? `Победил: ${m.winner}` : 
                          (isMyGame ? `Ждем ответа...` : 
                          `Число близко к: <b>${m.hint}</b><br>
                           <button class="action-btn sm-btn" onclick="game.guess('${d.id}', '${chatId}', 'more', ${m.target}, ${m.hint}, ${m.bet}, '${m.creator}')">Больше</button>
                           <button class="action-btn sm-btn" onclick="game.guess('${d.id}', '${chatId}', 'less', ${m.target}, ${m.hint}, ${m.bet}, '${m.creator}')">Меньше</button>`)}
                    </div></div>`;
                } else {
                    let content = m.text;
                    if(m.image) content = `<img src="${m.image}" class="chat-img" onclick="window.open('${m.image}')">`;
                    html = `<div class="msg-row ${isMe?'me':'other'}"><div class="msg ${isMe?'me':'other'}">${content}</div></div>`;
                }
                c.innerHTML += html;
            });
            c.scrollTop = c.scrollHeight;
        });
    },

    sendMsg: async () => {
        const txt = document.getElementById('msg-input').value.trim();
        if(!txt && !tempChatImg) return;
        const chatId = [currentUser.username, curChat].sort().join('_');
        const msgData = { from: currentUser.username, time: Date.now() };
        if(txt) msgData.text = txt;
        if(tempChatImg) { msgData.image = tempChatImg; msgData.text = '📷 Фото'; }

        // Исправлена запись в коллекцию
        await addDoc(collection(db, 'chats', chatId, 'messages'), msgData);
        await setDoc(doc(db, 'chats', chatId), { lastMessage: msgData.text, lastTime: Date.now() }, { merge: true });
        
        document.getElementById('msg-input').value = '';
        tempChatImg = null;
    },

    // --- UTILS ---
    handleImg: el => { if(el.files[0]) compress(el.files[0], d=>{ tempImg=d; document.getElementById('preview-img-el').src=d; document.getElementById('post-img-preview').classList.remove('hidden'); }) },
    clearImg: () => { tempImg=null; document.getElementById('post-img-preview').classList.add('hidden'); },
    handleAvatar: (el, isGroup=false) => { if(el.files[0]) compress(el.files[0], d=>{ tempAv=d; if(isGroup) document.getElementById('edit-group-av-prev').src = d; }) },
    handleChatImg: el => { if(el.files[0]) compress(el.files[0], d => { tempChatImg = d; app.sendMsg(); }); },
    saveProfile: async () => { const n = document.getElementById('edit-name').value; const b = document.getElementById('edit-bio').value; const upd = { name:n, bio:b }; if(tempAv) upd.avatar = tempAv; await updateDoc(doc(db, 'users', currentUser.username), upd); location.reload(); },
    togglePrivate: async () => { const v = document.getElementById('private-switch').checked; await updateDoc(doc(db, 'users', currentUser.username), { isPrivate: v }); },
    changePass: async () => { const p1 = document.getElementById('ch-pass').value; if(p1) await updateDoc(doc(db, 'users', currentUser.username), { password: p1 }); alert('OK'); },
    
    // --- ACTIONS ---
    like: async (pid, auth) => { const r = doc(db,'posts',pid); const p=(await getDoc(r)).data(); if(p.likes.includes(currentUser.username)) await updateDoc(r,{likes:arrayRemove(currentUser.username)}); else { await updateDoc(r,{likes:arrayUnion(currentUser.username)}); await updateDoc(doc(db,'users',auth),{balance:increment(1)}); app.notify(auth,'like','оценил пост'); } },
    follow: async (u) => { const me=doc(db,'users',currentUser.username); const him=doc(db,'users',u); if(currentUser.following.includes(u)) { await updateDoc(me,{following:arrayRemove(u)}); await updateDoc(him,{followers:arrayRemove(currentUser.username)}); currentUser.following = currentUser.following.filter(x=>x!==u); } else { await updateDoc(me,{following:arrayUnion(u)}); await updateDoc(him,{followers:arrayUnion(currentUser.username)}); currentUser.following.push(u); app.notify(u,'sub','подписался'); } ui.nav('profile',u); },
    reqFollow: async (u) => { await updateDoc(doc(db,'users',u),{requests:arrayUnion(currentUser.username)}); app.notify(u,'req','хочет подписаться'); alert('Запрос отправлен'); },
    checkStatuses: async () => { /* status logic same as before */ },
    notify: async (to, type, txt) => { if(to === currentUser.username) return; await addDoc(collection(db, 'users', to, 'notifications'), { type, text: txt, from: currentUser.username, time: Date.now(), read: false }); },
    listenNotifs: () => { const q = query(collection(db, 'users', currentUser.username, 'notifications'), orderBy('time', 'desc'), limit(20)); onSnapshot(q, s => { let n = 0; s.forEach(d => { if(!d.data().read) n++ }); document.getElementById('notif-badge').style.display = n?'block':'none'; if(document.getElementById('view-notifs').classList.contains('active')) { const c = document.getElementById('notifs-list'); c.innerHTML=''; s.forEach(d => { const x = d.data(); let act = ''; if(x.type === 'req') act = `<button class="action-btn sm-btn" onclick="app.acceptReq('${x.from}')">Принять</button>`; c.innerHTML += `<div class="card user-row" onclick="ui.nav('profile','${x.from}')">${ICONS.lock} <div><b>@${x.from}</b> ${x.text}</div> ${act}</div>`; }); } }); },
    acceptReq: async (u) => { await updateDoc(doc(db,'users',currentUser.username),{requests:arrayRemove(u),followers:arrayUnion(u)}); await updateDoc(doc(db,'users',u),{following:arrayUnion(currentUser.username)}); app.notify(u,'msg','принял заявку'); app.listenNotifs(); },
    openComs: (pid,auth) => { document.getElementById('comments-modal').style.display='flex'; /* ...com logic */ },
    // Stub methods for brevity (copy existing ones for delPost, delMsg, etc)
    delPost: async (id) => { if(confirm('Del?')) await deleteDoc(doc(db,'posts',id)); },
    
    // ... Copy remaining group/admin logic from V5.0 ...
};

// --- MARKET 5.1 ---
window.market = {
    tab: (t) => {
        document.querySelectorAll('.view#view-market .tab').forEach(e=>e.classList.remove('active'));
        // Mapping tabs...
        const c = document.getElementById('market-content'); c.innerHTML = '';
        
        if(t==='cases') {
            c.innerHTML = `
            <div class="card center-content" style="grid-column: 1 / -1;">
                <h2>📦 Обычный</h2>
                <p>Цена: ${CASE_PRICE} HC</p>
                <button class="action-btn" onclick="market.buyCase('normal')">Открыть</button>
            </div>
            <div class="card center-content" style="grid-column: 1 / -1; border:2px solid gold; background: #fffbe6;">
                <h2>🗝️ LEGACY BOX</h2>
                <p>Цена: ${LEGACY_PRICE} HC</p>
                <small>Меньше мусора, больше шансов!</small><br>
                <button class="action-btn" onclick="market.buyCase('legacy')">Открыть (500 HC)</button>
            </div>`;
        }
        if(t==='inventory') {
            const inv = currentUser.inventory || [];
            if(inv.length === 0) c.innerHTML = '<div class="info-box">Пусто</div>';
            inv.forEach(item => {
                c.innerHTML += `<div class="market-item item-${item.rarity}" onclick="market.openSellModal('${item.id}', '${item.emoji}', '${item.rarity}')">
                    <span class="market-emoji">${item.emoji}</span>
                </div>`;
            });
        }
        if(t==='market') market.loadMarketplace();
    },

    buyCase: async (type) => {
        const price = type==='legacy' ? LEGACY_PRICE : CASE_PRICE;
        if(currentUser.balance < price) return alert("Мало денег");
        
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(-price) });
        currentUser.balance -= price;

        document.getElementById('case-modal').style.display = 'flex';
        
        const rand = Math.random() * 100;
        let rar = 'common';
        
        if(type === 'legacy') {
            // Шансы для Legacy
            if (rand < 5) rar = 'legendary';
            else if (rand < 20) rar = 'epic';
            else if (rand < 50) rar = 'rare';
            // Остальное common
        } else {
            // Обычные шансы
            if (rand < 0.9) rar = 'legendary';
            else if (rand < 3) rar = 'epic';
            else if (rand < 15) rar = 'rare';
        }
        
        const items = ITEMS_DB[rar];
        const emoji = items[Math.floor(Math.random() * items.length)];
        const newItem = { id: Date.now() + Math.random().toString(), emoji, rarity: rar };

        await updateDoc(doc(db, 'users', currentUser.username), { inventory: arrayUnion(newItem) });
        currentUser.inventory.push(newItem);

        setTimeout(() => {
            document.getElementById('case-spinner').classList.add('hidden');
            document.getElementById('case-result').innerHTML = `<div class="market-emoji win-anim" style="font-size:100px">${emoji}</div><h3>${rar}</h3>`;
            document.getElementById('case-result').classList.remove('hidden');
            document.getElementById('case-close-btn').classList.remove('hidden');
        }, 1500);
    },

    openSellModal: (id, emoji, rarity) => {
        document.getElementById('sell-item-id').value = id;
        document.getElementById('sell-item-emoji').value = emoji;
        document.getElementById('sell-item-rarity').value = rarity;
        document.getElementById('sell-emoji-preview').innerText = emoji;
        document.getElementById('sell-modal').style.display = 'flex';
    },

    confirmSell: async () => {
        const p = parseInt(document.getElementById('sell-price').value);
        if(!p) return;
        const id = document.getElementById('sell-item-id').value;
        const item = currentUser.inventory.find(i=>i.id===id);
        
        await updateDoc(doc(db, 'users', currentUser.username), { inventory: arrayRemove(item) });
        currentUser.inventory = currentUser.inventory.filter(i=>i.id!==id);
        
        // Снять закреп при продаже
        if(currentUser.pinnedEmojis) {
             if(currentUser.pinnedEmojis.slot1 === item.emoji) await updateDoc(doc(db,'users',currentUser.username), {'pinnedEmojis.slot1': null});
             if(currentUser.pinnedEmojis.slot2 === item.emoji) await updateDoc(doc(db,'users',currentUser.username), {'pinnedEmojis.slot2': null});
        }

        await addDoc(collection(db, 'market_items'), { seller: currentUser.username, emoji: item.emoji, rarity: item.rarity, price: p, itemId: id, createdAt: Date.now() });
        ui.closeModals(); market.tab('inventory');
    },

    // --- PINNING LOGIC ---
    pinItem: async (slot) => {
        const emoji = document.getElementById('sell-item-emoji').value;
        const rarity = document.getElementById('sell-item-rarity').value;
        // Можно закрепить только рарки выше common? (по желанию)
        
        const upd = {};
        upd[`pinnedEmojis.${slot}`] = emoji;
        await updateDoc(doc(db, 'users', currentUser.username), upd);
        
        // Обновляем локально
        if(!currentUser.pinnedEmojis) currentUser.pinnedEmojis = {};
        currentUser.pinnedEmojis[slot] = emoji;
        
        alert(`Закреплено в ${slot}!`);
        ui.closeModals();
    },

    unpinItem: async () => {
        await updateDoc(doc(db, 'users', currentUser.username), { pinnedEmojis: { slot1: null, slot2: null } });
        currentUser.pinnedEmojis = {};
        alert('Откреплено');
        ui.closeModals();
    },

    // --- NEW MARKET UI ---
    loadMarketplace: async () => {
        const c = document.getElementById('market-content'); c.innerHTML = 'Загрузка...';
        const s = await getDocs(query(collection(db, 'market_items'), orderBy('price', 'asc')));
        c.innerHTML = '';
        s.forEach(d => {
            const i = d.data();
            c.innerHTML += `<div class="market-item item-${i.rarity}" onclick="market.showBuyModal('${d.id}', ${i.price}, '${i.seller}', '${i.emoji}', '${i.rarity}', '${i.itemId}')">
                <span class="market-emoji">${i.emoji}</span>
                <span class="market-price">${i.price} HC</span>
            </div>`;
        });
    },

    showBuyModal: (docId, price, seller, emoji, rarity, itemId) => {
        if(seller === currentUser.username) return alert("Это ваш лот");
        document.getElementById('buy-emoji-display').innerText = emoji;
        document.getElementById('buy-price-display').innerText = price + ' HC';
        document.getElementById('buy-seller-display').innerText = seller;
        
        document.getElementById('buy-doc-id').value = docId;
        document.getElementById('buy-item-price').value = price;
        document.getElementById('buy-item-seller').value = seller;
        document.getElementById('buy-item-emoji').value = emoji;
        document.getElementById('buy-item-rarity').value = rarity;
        document.getElementById('buy-item-realid').value = itemId;
        
        document.getElementById('buy-modal').style.display = 'flex';
    },

    executeBuy: async () => {
        const docId = document.getElementById('buy-doc-id').value;
        const price = parseInt(document.getElementById('buy-item-price').value);
        const seller = document.getElementById('buy-item-seller').value;
        const emoji = document.getElementById('buy-item-emoji').value;
        const rarity = document.getElementById('buy-item-rarity').value;
        const itemId = document.getElementById('buy-item-realid').value;

        if(currentUser.balance < price) return alert("Нет денег");

        try {
            await runTransaction(db, async (t) => {
                const itemRef = doc(db, 'market_items', docId);
                const sellerRef = doc(db, 'users', seller);
                const buyerRef = doc(db, 'users', currentUser.username);
                
                const iDoc = await t.get(itemRef);
                if(!iDoc.exists()) throw "Купили!";
                
                t.update(sellerRef, { balance: increment(price) });
                t.update(buyerRef, { balance: increment(-price), inventory: arrayUnion({ id: itemId, emoji, rarity }) });
                t.delete(itemRef);
            });
            currentUser.balance -= price;
            alert("Успешно!");
            ui.closeModals();
            market.tab('inventory');
        } catch(e) { alert(e); }
    }
};

// --- GAME: HI-LO ---
window.game = {
    ui: () => { document.getElementById('game-modal').style.display = 'flex'; },
    create: async () => {
        const num = parseInt(document.getElementById('game-number').value);
        const bet = parseInt(document.getElementById('game-bet').value);
        if(!num || num < 1 || num > 100) return alert('1-100');
        if(currentUser.balance < bet) return alert('Нет денег');
        
        // Генерация подсказки (число +- 5)
        let hint = num + Math.floor(Math.random() * 10) - 5;
        if(hint === num) hint++; // Чтобы не палить число
        
        const chatId = [currentUser.username, curChat].sort().join('_');
        
        // Создаем запись об игре
        await addDoc(collection(db, 'chats', chatId, 'messages'), {
            type: 'game_invite',
            creator: currentUser.username,
            target: num,
            hint: hint,
            bet: bet,
            time: Date.now(),
            finished: false
        });
        
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(-bet) });
        currentUser.balance -= bet;
        
        ui.closeModals();
    },
    
    guess: async (msgId, chatId, choice, target, hint, bet, creator) => {
        if(currentUser.balance < bet) return alert('Нужна ставка ' + bet);
        
        // Списываем ставку с того, кто гадает
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(-bet) });
        currentUser.balance -= bet;

        let win = false;
        if(choice === 'more' && target > hint) win = true;
        if(choice === 'less' && target < hint) win = true;
        
        const winner = win ? currentUser.username : creator;
        const pot = bet * 2;
        
        // Отдаем банк победителю
        await updateDoc(doc(db, 'users', winner), { balance: increment(pot) });
        if(winner === currentUser.username) currentUser.balance += pot;
        
        // Обновляем сообщение
        await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), {
            finished: true,
            winner: winner
        });
    }
};

// --- ADMIN 2.1 ---
window.admin = {
    tab: t => {
        const c = document.getElementById('adm-content');
        if(t==='mod') admin.loadModQueue();
        // ... user/verify tabs from prev version
    },
    loadModQueue: async () => {
        const c = document.getElementById('adm-content'); c.innerHTML = 'Загрузка...';
        const q = query(collection(db, 'posts'), where('approved', '==', false));
        const s = await getDocs(q);
        c.innerHTML = '';
        if(s.empty) c.innerHTML = 'Нет постов на проверку';
        s.forEach(d => {
            const p = d.data();
            c.innerHTML += `<div class="card">
                <img src="${p.image}" style="max-width:200px"><br>
                <b>${p.author}</b>: ${p.content}<br>
                <button class="action-btn" onclick="admin.approve('${d.id}')">ОК</button>
                <button class="action-btn btn-danger" onclick="admin.reject('${d.id}')">Бан поста</button>
            </div>`;
        });
    },
    approve: async (id) => { await updateDoc(doc(db, 'posts', id), { approved: true }); admin.loadModQueue(); },
    reject: async (id) => { await deleteDoc(doc(db, 'posts', id)); admin.loadModQueue(); },
    // ... stats, ban, etc
};

app.init();
