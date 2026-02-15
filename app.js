import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, getDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, onSnapshot, query, orderBy, where, limit, increment, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- КОНФИГ FIREBASE (Вставь свои ключи!) ---
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

// --- ГЛОБАЛЫ ---
window.currentUser = null;
let listeners = {};
let tempImg = null;       // Для постов
let tempChatImg = null;   // Для чата
let tempAv = null;        // Для аватарки
let activeGame = null;    // Текущая игра
let gameTimerInt = null;
let activeGroupId = null;
let curChat = null;       // ID собеседника
let activeChatUnsub = null;
let paintingColor = 'black'; // Цвет баллончика

// База предметов (для генерации)
const ITEMS_DB = {
    tools: ['🔫', '🥛', '🎨', '🖌️', '🧴', '🧪'], // Тэгер, Краска, Палитра...
    emojis: ['🤡', '👻', '👺', '💀', '👽', '💩', '🤖', '👾'] 
};

// --- ХЕЛПЕРЫ ---
const compress = (file, cb) => {
    const r = new FileReader(); r.readAsDataURL(file);
    r.onload = e => { const i = new Image(); i.src = e.target.result; i.onload = () => { const c = document.createElement('canvas'); const max = 800; let w=i.width, h=i.height; if(w>h){if(w>max){h*=max/w;w=max}}else{if(h>max){w*=max/h;h=max}} c.width=w; c.height=h; c.getContext('2d').drawImage(i,0,0,w,h); cb(c.toDataURL('image/jpeg', 0.8)); } }
};

// Генератор аватарок с учетом новых эффектов
const getAv = (u, sz, addFrame=false) => {
    if(!u) return '';
    let src = u.avatar || u.authorAvatar || 'https://via.placeholder.com/80';
    let frameClass = '', satellites = '';
    
    // Поддержка старого и нового формата инвентаря
    const inv = u.inventory || u.authorInventory || [];
    const pins = u.pinnedEmojis || {};

    if(addFrame && inv.length > 0) {
        // Ищем самые редкие предметы для рамки
        if(inv.some(i => i.rarity === 'mythical')) frameClass = 'rarity-mythical';
        else if(inv.some(i => i.rarity === 'legendary')) frameClass = 'frame-legendary';
        else if(inv.some(i => i.rarity === 'epic')) frameClass = 'frame-epic';
    }
    
    if(pins.slot1) satellites += `<span class="sat-icon sat-1">${pins.slot1}</span>`;
    if(pins.slot2) satellites += `<span class="sat-icon sat-2">${pins.slot2}</span>`;

    return `<div class="avatar-wrap"><img src="${src}" class="avatar ${sz} ${frameClass}">${satellites}</div>`;
};

const parseTime = ts => new Date(ts).toLocaleDateString();

// NEW: Парсер текста (ссылки и @user)
const parseText = (txt) => {
    if(!txt) return '';
    // Заменяем @username на ссылку
    let p = txt.replace(/@([a-zA-Z0-9_]+)/g, '<span style="color:#3390ec; cursor:pointer; font-weight:bold" onclick="window.ui.nav(\'profile\', \'$1\')">@$1</span>');
    // Можно добавить авто-ссылки http...
    return p;
};

// --- UI NAVIGATOR ---
window.ui = {
    nav: (v, p) => {
        if(activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; } // Отписка от чата
        if(v === 'profile' && !p) p = currentUser.username;
        
        document.querySelectorAll('.view').forEach(e => e.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
        document.querySelectorAll('.modal-overlay').forEach(e => e.classList.add('hidden'));

        if(v === 'chat-room') document.getElementById('view-chat-room').classList.remove('hidden');
        else {
            document.getElementById('view-chat-room').classList.add('hidden');
            const el = document.getElementById('view-'+(v==='admin'?'admin':v));
            if(el) el.classList.add('active');
        }
        
        // Подсветка меню
        const map = {'feed':0, 'market':1, 'groups':2, 'chats':3, 'rich':4, 'profile':5, 'admin':6, 'search':7, 'settings':8};
        const items = document.querySelectorAll('.nav-item');
        if(map[v] !== undefined && items[map[v]]) items[map[v]].classList.add('active');

        // Роутинг
        if(v==='feed') window.app.loadFeed();
        if(v==='chats') window.app.loadChats();
        if(v==='market') window.market.tab('cases');
        if(v==='rich') window.app.loadRich();
        if(v==='profile') window.app.loadProfile(p);
        if(v==='chat-room') window.app.loadChatRoom(p);
        if(v==='groups') window.app.loadGroups();
        if(v==='admin') window.admin.tab('users');
        if(v==='settings' && currentUser.isAdmin) document.getElementById('settings-admin-btn').classList.remove('hidden');
    },
    closeModals: () => {
        document.querySelectorAll('.modal-overlay').forEach(e => e.classList.add('hidden'));
        document.getElementById('case-result').classList.add('hidden');
        document.getElementById('case-spinner').classList.remove('hidden');
        document.getElementById('case-close-btn').classList.add('hidden');
    },
    toggleAuth: (mode) => { document.getElementById('login-box').classList.toggle('hidden', mode!=='login'); document.getElementById('reg-box').classList.toggle('hidden', mode!=='reg'); },
    togglePass: (id) => { const el = document.getElementById(id); el.type = el.type==='password'?'text':'password'; },
    setTab: (t, btn) => {
        document.querySelectorAll('.set-page').forEach(e=>e.classList.add('hidden'));
        document.getElementById('set-'+t).classList.remove('hidden');
        document.querySelectorAll('#view-settings .tab').forEach(e=>e.classList.remove('active'));
        btn.classList.add('active');
    },
    theme: () => {
        const d = document.getElementById('theme-switch').checked;
        document.body.style.background = d ? '#0f0f0f' : '#fff';
        document.body.style.color = d ? '#fff' : '#000';
    }
};

// --- APP CORE ---
window.app = {
    init: async () => {
        const u = localStorage.getItem('user');
        if(u) {
            const s = await getDoc(doc(db, 'users', u));
            if(s.exists()) {
                currentUser = s.data();
                
                // MIGRATION FIXES (Для старых аккаунтов)
                let fix = {};
                if(!currentUser.inventory) fix.inventory = [];
                if(!currentUser.pinnedEmojis) fix.pinnedEmojis = {};
                if(!currentUser.balance) fix.balance = 0;
                if(!currentUser.tickets) fix.tickets = 0; // NEW: Билеты
                if(!currentUser.graffiti) fix.graffiti = null; // NEW: Стена
                
                if(Object.keys(fix).length > 0) { 
                    await updateDoc(doc(db, 'users', u), fix); 
                    currentUser = {...currentUser, ...fix}; 
                }
                
                if(currentUser.isBanned) return alert('ВАШ АККАУНТ ЗАБЛОКИРОВАН');
                
                document.getElementById('auth-screen').classList.add('hidden');
                document.getElementById('app-screen').classList.remove('hidden');
                if(currentUser.isAdmin) document.getElementById('nav-admin').classList.remove('hidden');
                
                // Update Settings UI
                document.getElementById('settings-bal').innerText = currentUser.balance;
                document.getElementById('settings-tickets').innerText = currentUser.tickets;
                
                window.ui.nav('feed');
            }
        }
        document.getElementById('splash').classList.add('hidden');
    },
    login: async () => {
        const u = document.getElementById('login-user').value.toLowerCase().trim();
        const p = document.getElementById('login-pass').value;
        const s = await getDoc(doc(db, 'users', u));
        if(s.exists() && s.data().password === p) {
            if(s.data().isBanned) return alert('BAN');
            localStorage.setItem('user', u);
            location.reload();
        } else alert('Неверный логин или пароль');
    },
    register: async () => {
        const u = document.getElementById('reg-user').value.toLowerCase().trim();
        const n = document.getElementById('reg-name').value;
        const p = document.getElementById('reg-pass').value;
        // Basic check
        if(u.length < 3) return alert('Короткий ник');
        
        await setDoc(doc(db, 'users', u), { 
            username: u, name: n, password: p, 
            balance: 10, tickets: 0, 
            inventory: [], pinnedEmojis: {}, 
            followers:[], following:[], blocked:[], 
            isAdmin:false, isVerified:false, 
            graffiti: null, // New
            createdAt: Date.now() 
        });
        alert('Аккаунт создан! Войдите.'); window.ui.toggleAuth('login');
    },
    logout: () => { localStorage.clear(); location.reload(); },
    // --- POSTS LOGIC (UPDATED WITH MAGAZINE & LINKS) ---
    openCreatePost: () => { 
        document.getElementById('create-post-modal').classList.remove('hidden'); 
        window.app.setPostType('normal', document.querySelector('.tab.active')); // Reset to normal
    },
    
    setPostType: (type, btn) => {
        document.getElementById('post-type-normal').classList.toggle('hidden', type !== 'normal');
        document.getElementById('post-type-magazine').classList.toggle('hidden', type !== 'magazine');
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        window.currentPostType = type;
    },

    handleImg: (el) => { 
        if(el.files[0]) compress(el.files[0], d => { 
            tempImg = d; 
            document.getElementById('preview-img-el').src=d; 
            document.getElementById('post-img-preview').classList.remove('hidden'); 
        }); 
    },
    clearImg: () => { tempImg = null; document.getElementById('post-img-preview').classList.add('hidden'); },

    createPost: async () => {
        const type = window.currentPostType || 'normal';
        let content, images = [], actionBtn = null;
        
        // Action Button Data
        const btnText = document.getElementById('post-btn-text').value;
        const btnLink = document.getElementById('post-btn-link').value;
        if(btnText && btnLink) actionBtn = { text: btnText, link: btnLink };

        if(type === 'normal') {
            content = document.getElementById('post-text').value;
            if(tempImg) images.push(tempImg);
        } else {
            // Magazine Logic (Placeholder for future expansion, simplified now)
            content = document.getElementById('mag-text').value; 
            // In full version, here we would collect 5 images from slots
            alert('Журнальный режим пока в разработке, пост будет создан как обычный.');
            type = 'normal'; // Fallback
        }

        if(!content && images.length === 0) return alert('Пустой пост!');
        
        // AUTO-MODERATION
        const needsMod = (images.length > 0 || actionBtn) ? true : false;
        
        await addDoc(collection(db, 'posts'), {
            author: currentUser.username, 
            name: currentUser.name, 
            content: content, 
            image: images[0] || null, // Simplified for now
            type: type,
            actionBtn: actionBtn,
            likes: [], 
            createdAt: Date.now(),
            approved: !needsMod, // If mod needed, approved=false
            authorInventory: currentUser.inventory, 
            pinnedEmojis: currentUser.pinnedEmojis,
            groupId: activeGroupId
        });
        
        if(needsMod) alert('Пост отправлен на проверку (Фото/Ссылка)');
        else alert('Опубликовано!');
        
        document.getElementById('post-text').value = ''; 
        window.app.clearImg(); 
        window.ui.closeModals();
        if(activeGroupId) window.app.loadProfile(activeGroupId);
    },

    loadFeed: () => {
        if(listeners.feed) listeners.feed(); // Unsub old
        const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30));
        listeners.feed = onSnapshot(q, s => {
            let html = '';
            s.forEach(d => {
                const p = d.data(); p.id = d.id;
                // Filter unapproved / blocked
                if(!p.approved && p.author !== currentUser.username && !currentUser.isAdmin) return;
                if(p.groupId) return; // Don't show group posts in main feed
                if(currentUser.blocked && currentUser.blocked.includes(p.author)) return;
                html += window.app.renderPost(p);
            });
            document.getElementById('feed-content').innerHTML = html;
        });
    },

    renderPost: (p) => {
        const fakeUser = { avatar: p.avatar, authorAvatar: p.authorAvatar, inventory: p.authorInventory, pinnedEmojis: p.pinnedEmojis };
        // Action Button HTML
        const actionHtml = p.actionBtn ? `<a href="${p.actionBtn.link}" target="_blank" class="action-btn-link">${p.actionBtn.text}</a>` : '';
        
        return `<div class="card">
            <div class="user-row" onclick="window.ui.nav('profile','${p.author}')">
                ${getAv(fakeUser, 'av-40', true)}
                <div>
                    <b>${p.name}</b> ${p.verified?'<span style="color:#3390ec">✓</span>':''}
                    <br><small class="post-date">${parseTime(p.createdAt)} ${!p.approved?'[MOD]':''}</small>
                </div>
            </div>
            <div style="margin:10px 0; white-space:pre-wrap;">${parseText(p.content)}</div>
            ${p.image ? `<img src="${p.image}" class="post-img" onclick="window.open('${p.image}')">` : ''}
            ${actionHtml}
            <div class="user-row" style="margin-top:10px; justify-content:space-between;">
                <button class="action-btn btn-sec" onclick="window.app.like('${p.id}', '${p.author}')">❤️ ${p.likes?.length||0}</button>
                <button class="action-btn btn-sec" onclick="window.app.openComs('${p.id}')">💬</button>
                ${currentUser.isAdmin || p.author===currentUser.username ? `<button class="action-btn btn-danger sm-btn" onclick="window.app.delPost('${p.id}')">Del</button>` : ''}
            </div>
        </div>`;
    },
    
    // --- PROFILE SYSTEM (WITH GRAFFITI WALL) ---
    loadProfile: async (u) => {
        const c = document.getElementById('profile-head');
        const pc = document.getElementById('profile-posts');
        c.innerHTML = 'Загрузка...'; pc.innerHTML = '';
        activeGroupId = null;

        // Check User
        const s = await getDoc(doc(db, 'users', u));
        if(s.exists()) {
            const user = s.data();
            const isMe = u === currentUser.username;
            const isFollow = currentUser.following.includes(u);
            const isBlocked = currentUser.blocked && currentUser.blocked.includes(u);
            
            // GRAFFITI WALL RENDER
            let wallHtml = '';
            if(user.graffiti) {
                wallHtml = `<div class="card" style="background:#222; color:white; text-align:center;">
                    <small>Стена (by ${user.graffiti.author})</small>
                    <img src="${user.graffiti.img}" style="width:100%; border-radius:5px; margin-top:5px;">
                </div>`;
            }

            // BUTTONS LOGIC
            let btns = '';
            if(isMe) {
                btns = `<button class="action-btn sm-btn" onclick="window.ui.nav('settings')">Ред.</button>`;
            } else {
                if(isBlocked) {
                    btns = `<button class="action-btn btn-sec" onclick="window.app.block('${u}', false)">Разблокировать</button>`;
                } else {
                    btns = `<button class="action-btn sm-btn" onclick="window.app.follow('${u}')">${isFollow?'Отписаться':'Подписаться'}</button> 
                            <button class="action-btn sm-btn btn-sec" onclick="window.ui.nav('chat-room','${u}')">Чат</button>
                            <button class="action-btn sm-btn btn-danger" onclick="window.app.block('${u}', true)">Блок</button>`;
                    
                    // TAGGER BUTTON (Check if I have a Tagger)
                    const hasTagger = currentUser.inventory.find(i => i.emoji === '🔫'); // Gun emoji for Tagger
                    if(hasTagger) {
                        btns += `<br><button class="action-btn full-width mt-10" style="background:#000" onclick="window.graffiti.open('${u}')">🖌️ ЗА ТЭГАТЬ</button>`;
                    }
                }
            }
            
            c.innerHTML = `
                ${wallHtml}
                <div class="card center-content">
                    ${getAv(user, 'av-80', true)}
                    <h2>${user.name} ${user.isVerified?'<span style="color:#3390ec">✓</span>':''}</h2>
                    <div style="color:gray">@${user.username}</div>
                    <div style="display:flex; justify-content:center; gap:20px; margin:10px;">
                        <b onclick="window.app.showList('followers','${u}')">${user.followers?.length||0} подп.</b>
                        <b onclick="window.app.showList('following','${u}')">${user.following?.length||0} подписки</b>
                    </div>
                    ${btns}
                </div>`;
            
            // Load User Posts
            const q = query(collection(db, 'posts'), where('author', '==', u));
            const ps = await getDocs(q);
            ps.forEach(d => { 
                const p = d.data(); p.id=d.id;
                if(!p.groupId && p.approved) pc.innerHTML += window.app.renderPost(p); 
            });

        } else {
            // Check Group
            const g = await getDoc(doc(db, 'groups', u));
            if(g.exists()) {
                activeGroupId = u;
                const group = g.data();
                const isOwner = group.owner === currentUser.username;
                c.innerHTML = `<div class="card center-content">
                    <h2>${group.name}</h2>
                    <p>${group.desc}</p>
                    <button class="action-btn" onclick="window.app.openCreatePost()">Пост</button>
                    ${isOwner ? `<button class="action-btn btn-sec sm-btn" onclick="window.app.editGroup('${u}')">Ред</button>` : ''}
                </div>`;
                const q = query(collection(db, 'posts'), where('groupId', '==', u));
                const ps = await getDocs(q);
                ps.forEach(d => pc.innerHTML += window.app.renderPost({...d.data(), id:d.id}));
            } else {
                c.innerHTML = 'Профиль не найден';
            }
        }
    },
    
    // --- SOCIAL ACTIONS ---
    like: async (id, auth) => {
        const r = doc(db, 'posts', id);
        const p = (await getDoc(r)).data();
        if(p.likes.includes(currentUser.username)) await updateDoc(r, {likes: arrayRemove(currentUser.username)});
        else { 
            await updateDoc(r, {likes: arrayUnion(currentUser.username)}); 
            window.app.notify(auth, 'like', 'Лайкнул ваш пост'); 
        }
    },
    follow: async (u) => {
        const me = doc(db, 'users', currentUser.username);
        const him = doc(db, 'users', u);
        if(currentUser.following.includes(u)) {
            await updateDoc(me, {following: arrayRemove(u)});
            await updateDoc(him, {followers: arrayRemove(currentUser.username)});
            currentUser.following = currentUser.following.filter(x=>x!==u);
        } else {
            await updateDoc(me, {following: arrayUnion(u)});
            await updateDoc(him, {followers: arrayUnion(currentUser.username)});
            currentUser.following.push(u);
            window.app.notify(u, 'sub', 'Подписался на вас');
        }
        window.app.loadProfile(u);
    },
    block: async (u, doBlock) => {
        const me = doc(db, 'users', currentUser.username);
        if(doBlock) { 
            await updateDoc(me, {blocked: arrayUnion(u)}); 
            if(!currentUser.blocked) currentUser.blocked=[]; 
            currentUser.blocked.push(u); 
        } else { 
            await updateDoc(me, {blocked: arrayRemove(u)}); 
            currentUser.blocked = currentUser.blocked.filter(x=>x!==u); 
        }
        window.app.loadProfile(u);
    },
    // --- CHAT SYSTEM (UPDATED WITH DECOR) ---
    loadChats: async () => {
        const c = document.getElementById('chats-list'); c.innerHTML = '';
        if(currentUser.following.length === 0) return c.innerHTML = 'Подпишитесь на кого-нибудь, чтобы начать чат';
        
        for(const f of currentUser.following) {
            const u = await getDoc(doc(db, 'users', f));
            if(u.exists()) c.innerHTML += `<div class="card user-row" onclick="window.ui.nav('chat-room','${f}')">${getAv(u.data(),'av-40')} <b>${u.data().name}</b></div>`;
        }
    },

    loadChatRoom: async (u) => {
        curChat = u;
        document.getElementById('chat-title').innerText = u;
        const id = [currentUser.username, u].sort().join('_');
        const c = document.getElementById('msg-container');
        
        // --- LOAD CHAT DECOR ---
        // We check if chat document exists and has decor settings
        const chatDocRef = doc(db, 'chats', id);
        const chatSnap = await getDoc(chatDocRef);
        
        if(chatSnap.exists()) {
            const data = chatSnap.data();
            if(data.bg) document.getElementById('chat-bg-layer').style.backgroundImage = `url('${data.bg}')`;
            if(data.fx) document.getElementById('chat-fx-layer').style.backgroundImage = `url('${data.fx}')`;
        } else {
            // Set default if no decor
            document.getElementById('chat-bg-layer').style.backgroundImage = '';
            document.getElementById('chat-fx-layer').style.backgroundImage = '';
        }

        // --- MESSAGES ---
        if(activeChatUnsub) activeChatUnsub();
        const q = query(collection(db, 'chats', id, 'messages'), orderBy('time','asc'));
        activeChatUnsub = onSnapshot(q, s => {
            c.innerHTML = '';
            s.forEach(d => {
                const m = d.data();
                const isMe = m.from === currentUser.username;
                
                let content = m.text;
                if(m.image) content = `<img src="${m.image}" class="chat-img" onclick="window.open('${m.image}')">`;
                
                if(m.type === 'game_invite') {
                    // Game Invite Logic
                    const status = m.finished ? `Завершено. Победил: ${m.winner}` : `Ставка: ${m.bet} HC`;
                    const action = !m.finished && !isMe ? `onclick="window.game.start('${d.id}','${id}',${m.target},${m.hint},${m.bet},'${m.creator}')"` : '';
                    const style = m.finished ? 'background:#555; cursor:default;' : '';
                    
                    c.innerHTML += `<div class="msg-row ${isMe?'me':'other'}">
                        <div class="msg game" style="${style}" ${action}>
                            🎲 ИГРАТЬ<br><small>${status}</small>
                        </div>
                    </div>`;
                } else {
                    c.innerHTML += `<div class="msg-row ${isMe?'me':'other'}">
                        <div class="msg ${isMe?'me':'other'}">${content}</div>
                    </div>`;
                }
            });
            c.scrollTop = c.scrollHeight;
        });
    },

    sendMsg: async () => {
        const txt = document.getElementById('msg-input').value;
        if(!txt && !tempChatImg) return;
        const id = [currentUser.username, curChat].sort().join('_');
        
        // Ensure chat document exists for decor storage
        const chatRef = doc(db, 'chats', id);
        const chatSnap = await getDoc(chatRef);
        if(!chatSnap.exists()) await setDoc(chatRef, { created: Date.now() });

        const d = { from: currentUser.username, text: txt, time: Date.now() };
        if(tempChatImg) { d.image = tempChatImg; d.text = '📷 Фото'; }
        
        await addDoc(collection(db, 'chats', id, 'messages'), d);
        document.getElementById('msg-input').value = ''; tempChatImg = null;
    },

    handleChatImg: (el) => { if(el.files[0]) compress(el.files[0], d => { tempChatImg = d; window.app.sendMsg(); }); },

    navToChatProfile: () => { window.ui.nav('profile', curChat); },
    
    // --- GAME LOGIC (FIXED BALANCE CHECK) ---
    createGame: async () => {
        const num = parseInt(document.getElementById('game-number').value);
        const bet = parseInt(document.getElementById('game-bet').value);
        
        if(currentUser.balance < bet) return alert('Недостаточно средств!');
        
        const id = [currentUser.username, curChat].sort().join('_');
        let hint = num + Math.floor(Math.random()*10)-5; // Simple hint logic
        
        // Deduct balance from creator
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(-bet) });
        
        await addDoc(collection(db, 'chats', id, 'messages'), { 
            type: 'game_invite', 
            creator: currentUser.username, 
            target: num, 
            hint: hint, 
            bet: bet, 
            time: Date.now(),
            finished: false 
        });
        window.ui.closeModals();
    },

    startGame: async (mid, cid, target, hint, bet, creator) => {
        // Check opponent balance
        if(currentUser.balance < bet) return alert('У вас недостаточно средств для ставки!');
        
        // Deduct balance from opponent (joiner)
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(-bet) });
        
        activeGame = { mid, cid, target, hint, bet, creator };
        document.getElementById('game-ui').classList.remove('hidden');
        document.getElementById('game-hint-num').innerText = hint;
        
        // Start Timer
        let tl = 100;
        const timerCircle = document.getElementById('timer-progress');
        if(gameTimerInt) clearInterval(gameTimerInt);
        
        gameTimerInt = setInterval(() => {
            tl -= 1; 
            timerCircle.style.strokeDashoffset = 283 - (tl / 100) * 283;
            if(tl <= 0) { 
                clearInterval(gameTimerInt); 
                window.game.finish(false, 'Время вышло'); // Auto-lose
            }
        }, 100); // 10 seconds total
    },
    
    makeGuess: (ch) => {
        clearInterval(gameTimerInt);
        const w = (ch==='more' && activeGame.target > activeGame.hint) || (ch==='less' && activeGame.target < activeGame.hint);
        window.game.finish(w, w?'Угадал!':'Мимо');
    },

    finishGame: async (isWin, msg) => {
        const winner = isWin ? currentUser.username : activeGame.creator;
        const pot = activeGame.bet * 2;
        
        document.getElementById('game-ui').classList.add('hidden');
        document.getElementById('game-result').classList.remove('hidden');
        document.getElementById('gr-title').innerText = isWin ? "ПОБЕДА" : "ПОРАЖЕНИЕ";
        document.getElementById('gr-real').innerText = activeGame.target;
        document.getElementById('gr-msg').innerText = msg;
        
        // Give pot to winner
        await updateDoc(doc(db, 'users', winner), { balance: increment(pot) });
        
        // Update chat message
        await updateDoc(doc(db, 'chats', activeGame.cid, 'messages', activeGame.mid), { 
            finished: true, 
            winner: winner 
        });
    }
};

// Bind Game functions to window.game namespace for HTML access
window.game = {
    openCreate: () => { document.getElementById('game-create-modal').classList.remove('hidden'); },
    create: window.app.createGame,
    start: window.app.startGame,
    makeGuess: window.app.makeGuess,
    finish: window.app.finishGame,
    close: () => { document.getElementById('game-result').classList.add('hidden'); }
};

// --- MARKET & INVENTORY SYSTEM (UPDATED) ---
window.market = {
    tab: (t) => {
        const c = document.getElementById('market-content'); c.innerHTML = '';
        document.querySelectorAll('.view#view-market .tab').forEach(e=>e.classList.remove('active'));
        // Set Active Tab
        const tabs = document.querySelectorAll('.view#view-market .tab');
        if(t==='cases') tabs[0].classList.add('active'); 
        if(t==='market') tabs[1].classList.add('active'); 
        if(t==='inventory') tabs[2].classList.add('active');

        if(t==='cases') {
            c.innerHTML = `
            <div class="card center-content">
                <h2>📦 Обычный Кейс</h2>
                <p>Эмодзи и Хлам</p>
                <button class="action-btn" onclick="window.market.buyCase('normal')">100 HC</button>
            </div>
            <div class="card center-content" style="border:2px solid gold">
                <h2>📦 Legacy Box</h2>
                <p>Шанс на Тэгер, Билеты и Мифики</p>
                <button class="action-btn btn-gold" onclick="window.market.buyCase('legacy')">500 HC</button>
            </div>`;
        }
        if(t==='inventory') {
            if(!currentUser.inventory || currentUser.inventory.length === 0) c.innerHTML = 'Пусто';
            else {
                // Разделяем инвентарь на категории для удобства
                const tools = currentUser.inventory.filter(i => ITEMS_DB.tools.includes(i.emoji));
                const emojis = currentUser.inventory.filter(i => !ITEMS_DB.tools.includes(i.emoji));
                
                if(tools.length > 0) {
                    c.innerHTML += '<h3>Инструменты</h3><div class="market-grid">';
                    tools.forEach(i => {
                        let extra = '';
                        if(i.emoji === '🔫') extra = `<span class="item-qty">${i.charges||0}</span>`; // Тэгер заряды
                        c.innerHTML += `<div class="market-item rarity-${i.rarity}" onclick="window.market.openSell('${i.id}','${i.emoji}','${i.rarity}')">
                            <span style="font-size:30px">${i.emoji}</span>${extra}
                        </div>`;
                    });
                    c.innerHTML += '</div>';
                }
                
                if(emojis.length > 0) {
                    c.innerHTML += '<h3>Эмодзи</h3><div class="market-grid">';
                    emojis.forEach(i => {
                        c.innerHTML += `<div class="market-item rarity-${i.rarity}" onclick="window.market.openSell('${i.id}','${i.emoji}','${i.rarity}')">
                            <span style="font-size:30px">${i.emoji}</span>
                        </div>`;
                    });
                    c.innerHTML += '</div>';
                }
            }
        }
        if(t==='market') window.market.load();
    },

    buyCase: async (type) => {
        const price = type === 'legacy' ? 500 : 100;
        if(currentUser.balance < price) return alert('Недостаточно средств!');
        
        await updateDoc(doc(db, 'users', currentUser.username), { balance: increment(-price) });
        
        // Генерация дропа
        let item = { id: Date.now() + Math.random().toString(), rarity: 'common', emoji: '💩' };
        
        if(type === 'legacy') {
            // Шанс на Билеты (Tickets) - 50%
            if(Math.random() < 0.5) {
                const amount = Math.floor(Math.random() * 3) + 1; // 1-3 билета
                await updateDoc(doc(db, 'users', currentUser.username), { tickets: increment(amount) });
                alert(`Выпали БИЛЕТЫ: ${amount} шт!`);
                return; // Билеты падают вместо предмета (или можно сделать вместе)
            }
            
            // Дроп предметов Legacy
            const rand = Math.random();
            if(rand < 0.01) { item.emoji = '🎨'; item.rarity = 'mythical'; } // Палитра
            else if(rand < 0.05) { item.emoji = '🔫'; item.rarity = 'legendary'; item.charges = 1; } // Тэгер
            else if(rand < 0.2) { item.emoji = '🥛'; item.rarity = 'rare'; } // Краска
            else { item.emoji = ITEMS_DB.emojis[Math.floor(Math.random() * ITEMS_DB.emojis.length)]; item.rarity = 'rare'; }
        } else {
            // Обычный кейс
            item.emoji = ITEMS_DB.emojis[Math.floor(Math.random() * ITEMS_DB.emojis.length)];
        }
        
        await updateDoc(doc(db, 'users', currentUser.username), { inventory: arrayUnion(item) });
        currentUser.balance -= price;
        alert(`Выпало: ${item.emoji} (${item.rarity.toUpperCase()})`);
        window.market.tab('inventory');
    },

    openSell: (id, em, r) => {
        document.getElementById('sell-item-id').value = id;
        document.getElementById('sell-item-emoji').value = em;
        document.getElementById('sell-item-rarity').value = r;
        document.getElementById('sell-emoji-preview').innerText = em;
        document.getElementById('sell-modal').classList.remove('hidden');
    },

    confirmSell: async () => {
        const p = parseInt(document.getElementById('sell-price').value);
        const id = document.getElementById('sell-item-id').value;
        const em = document.getElementById('sell-item-emoji').value;
        const rar = document.getElementById('sell-item-rarity').value;
        
        if(!p || p < 0) return alert('Укажите цену');

        // FIX: Надежное удаление (фильтрация массива)
        const itemToRemove = currentUser.inventory.find(i => i.id === id);
        if(!itemToRemove) return alert('Предмет не найден (уже продан?)');

        const newInv = currentUser.inventory.filter(i => i.id !== id);
        
        // Транзакция для надежности
        try {
            await updateDoc(doc(db, 'users', currentUser.username), { inventory: newInv });
            await addDoc(collection(db, 'market_items'), { 
                seller: currentUser.username, 
                emoji: em, 
                rarity: rar, 
                price: p, 
                itemId: id, // Original ID to restore if cancelled
                charges: itemToRemove.charges || 0 // Save charges if tool
            });
            alert('Выставлено на продажу');
            window.ui.closeModals(); 
            window.market.tab('inventory');
        } catch(e) {
            alert('Ошибка продажи: ' + e);
        }
    },

    load: async () => {
        const c = document.getElementById('market-content'); c.innerHTML='';
        const s = await getDocs(collection(db, 'market_items'));
        if(s.empty) c.innerHTML = 'На рынке пусто. Станьте первым продавцом!';
        s.forEach(d => {
            const i = d.data();
            c.innerHTML += `<div class="market-item rarity-${i.rarity}" onclick="window.market.buy('${d.id}',${i.price},'${i.emoji}','${i.seller}','${i.rarity}','${i.itemId}')">
                <span style="font-size:30px">${i.emoji}</span><br>
                <b>${i.price} HC</b>
            </div>`;
        });
    },

    buy: async (did, p, em, seller, rar, iid) => {
        document.getElementById('buy-doc-id').value = did;
        document.getElementById('buy-item-price').value = p;
        document.getElementById('buy-emoji-display').innerText = em;
        document.getElementById('buy-seller-display').innerText = seller;
        
        const btn = document.getElementById('buy-btn-action');
        
        if(seller === currentUser.username) {
            // Кнопка СНЯТЬ С ПРОДАЖИ (Возвращает предмет)
            btn.innerText = "Снять с продажи"; 
            btn.className = "action-btn btn-danger full-width";
            btn.onclick = () => window.market.cancel(did, em, rar, iid);
        } else {
            // Кнопка КУПИТЬ
            btn.innerText = `Купить за ${p} HC`;
            btn.className = "action-btn full-width";
            btn.onclick = () => window.market.execBuy(did, p, em, seller, rar, iid);
        }
        document.getElementById('buy-modal').classList.remove('hidden');
    },

    cancel: async (did, em, rar, iid) => {
        // Вернуть предмет владельцу
        const itemDoc = await getDoc(doc(db, 'market_items', did));
        const itemData = itemDoc.data();
        
        await deleteDoc(doc(db, 'market_items', did));
        
        // Restore with saved properties (charges)
        const restoredItem = { id: iid, emoji: em, rarity: rar };
        if(itemData.charges) restoredItem.charges = itemData.charges;
        
        await updateDoc(doc(db, 'users', currentUser.username), { inventory: arrayUnion(restoredItem) });
        alert('Предмет возвращен в инвентарь'); 
        window.ui.closeModals(); 
        window.market.tab('market');
    },

    execBuy: async (did, p, em, seller, rar, iid) => {
        if(currentUser.balance < p) return alert('Недостаточно средств');
        
        await runTransaction(db, async (t) => {
            const itemRef = doc(db, 'market_items', did);
            const iDoc = await t.get(itemRef);
            if(!iDoc.exists()) throw "Предмет уже куплен!";
            
            const itemData = iDoc.data();
            
            // Удаляем с рынка
            t.delete(itemRef);
            
            // Перечисляем деньги продавцу
            t.update(doc(db, 'users', seller), { balance: increment(p) });
            
            // Списываем у покупателя и даем предмет
            const boughtItem = { id: iid, emoji: em, rarity: rar };
            if(itemData.charges) boughtItem.charges = itemData.charges;
            
            t.update(doc(db, 'users', currentUser.username), { 
                balance: increment(-p), 
                inventory: arrayUnion(boughtItem) 
            });
        });
        
        alert('Покупка успешна!'); 
        window.ui.closeModals(); 
        window.market.tab('inventory');
    }
};
// --- GRAFFITI SYSTEM (NEW) ---
window.graffiti = {
    canvas: null,
    ctx: null,
    isPainting: false,
    targetUser: null,
    color: 'black',

    open: (u) => {
        window.graffiti.targetUser = u;
        const modal = document.getElementById('graffiti-modal');
        modal.classList.remove('hidden');
        
        // Init Canvas
        const c = document.getElementById('graffiti-canvas');
        window.graffiti.canvas = c;
        window.graffiti.ctx = c.getContext('2d');
        
        // Reset
        window.graffiti.clear();
        
        // Check Tools (Palette & Charges)
        const hasPalette = currentUser.inventory.find(i => i.emoji === '🎨');
        const tagger = currentUser.inventory.find(i => i.emoji === '🔫');
        
        document.getElementById('paint-charges').innerText = `(Зарядов: ${tagger.charges || 0})`;
        
        if(hasPalette) {
            document.getElementById('palette-controls').classList.remove('hidden');
        } else {
            document.getElementById('palette-controls').classList.add('hidden');
            window.graffiti.setColor('black');
        }

        // Touch Events
        c.addEventListener('mousedown', window.graffiti.start);
        c.addEventListener('mousemove', window.graffiti.draw);
        c.addEventListener('mouseup', window.graffiti.stop);
        c.addEventListener('touchstart', (e) => { e.preventDefault(); window.graffiti.start(e.touches[0]); });
        c.addEventListener('touchmove', (e) => { e.preventDefault(); window.graffiti.draw(e.touches[0]); });
        c.addEventListener('touchend', window.graffiti.stop);
    },

    setColor: (c) => {
        window.graffiti.color = c;
        // Visual feedback
        document.querySelectorAll('.color-swatch').forEach(s => s.style.border = '2px solid white');
        if(c !== 'black') document.querySelector(`.color-swatch.${c}`).style.border = '2px solid gold';
    },

    start: (e) => {
        window.graffiti.isPainting = true;
        window.graffiti.draw(e);
    },

    draw: (e) => {
        if(!window.graffiti.isPainting) return;
        const ctx = window.graffiti.ctx;
        const rect = window.graffiti.canvas.getBoundingClientRect();
        const x = (e.clientX || e.pageX) - rect.left;
        const y = (e.clientY || e.pageY) - rect.top;

        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        
        if(window.graffiti.color === 'gold') {
            const grad = ctx.createLinearGradient(0, 0, 300, 0);
            grad.addColorStop(0, "gold");
            grad.addColorStop(1, "#b8860b");
            ctx.strokeStyle = grad;
        } else {
            ctx.strokeStyle = window.graffiti.color;
        }

        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
    },

    stop: () => {
        window.graffiti.isPainting = false;
        window.graffiti.ctx.beginPath();
    },

    clear: () => {
        window.graffiti.ctx.clearRect(0, 0, 300, 150);
    },

    save: async () => {
        const tagger = currentUser.inventory.find(i => i.emoji === '🔫');
        if(!tagger || tagger.charges < 1) return alert('Тэгер пуст! Найдите краску 🥛');

        const imgData = window.graffiti.canvas.toDataURL(); // Base64
        
        // Save to target profile
        await updateDoc(doc(db, 'users', window.graffiti.targetUser), {
            graffiti: { author: currentUser.username, img: imgData, time: Date.now() }
        });
        
        // Deduct Charge
        // Find index of tagger to update specific item
        const tIdx = currentUser.inventory.findIndex(i => i.emoji === '🔫');
        if(tIdx > -1) {
            currentUser.inventory[tIdx].charges--;
            await updateDoc(doc(db, 'users', currentUser.username), { inventory: currentUser.inventory });
        }
        
        // Consume Palette if used color (Mythical item logic - debatable if single use, let's say keep palette but cooldown?)
        // For now, simple logic: Palette is permanent tool to unlock colors.
        
        alert('Затэгано! 🔫');
        window.ui.closeModals();
        window.app.loadProfile(window.graffiti.targetUser);
    }
};

// --- ADMIN PANEL (FULL RESTORE) ---
window.admin = {
    tab: (t) => {
        const c = document.getElementById('adm-content'); c.innerHTML='';
        document.querySelectorAll('.view#view-admin .tab').forEach(e=>e.classList.remove('active'));
        // Active tab logic needed here visually
        
        if(t==='users') {
            c.innerHTML = '<input class="search-bar" oninput="window.admin.search(this.value)" placeholder="Поиск юзера..."> <div id="adm-list"></div>';
        }
        if(t==='mod') window.admin.loadModQueue();
        if(t==='verify') window.admin.loadV();
    },

    search: async (v) => {
        if(!v) return;
        const s = await getDocs(query(collection(db, 'users'), where('username', '>=', v.toLowerCase()), limit(5)));
        const c = document.getElementById('adm-list'); c.innerHTML='';
        
        s.forEach(d => {
            const u = d.data();
            c.innerHTML += `<div class="card">
                <b>${u.username}</b> (Баланс: ${u.balance})
                <br>
                <div style="display:flex; gap:5px; flex-wrap:wrap; margin-top:5px;">
                    <button class="action-btn btn-danger sm-btn" onclick="window.admin.ban('${u.username}')">${u.isBanned?'РАЗБАНИТЬ':'ЗАБАНИТЬ'}</button>
                    <button class="action-btn btn-sec sm-btn" onclick="window.admin.mute('${u.username}')">${u.isMuted?'Unmute':'Mute'}</button>
                    <button class="action-btn sm-btn" onclick="window.admin.warn('${u.username}')">WARN</button>
                    <button class="action-btn btn-gold sm-btn" onclick="window.admin.toggleAdmin('${u.username}', ${u.isAdmin})">${u.isAdmin?'Снять адм':'Дать адм'}</button>
                    <button class="action-btn btn-danger sm-btn" onclick="window.admin.delAcc('${u.username}')">УДАЛИТЬ</button>
                </div>
            </div>`;
        });
    },

    ban: async (u) => { const curr = (await getDoc(doc(db,'users',u))).data().isBanned; await updateDoc(doc(db,'users',u), {isBanned:!curr}); alert(curr?'Разбанен':'Забанен'); },
    
    mute: async (u) => { 
        const curr = (await getDoc(doc(db,'users',u))).data().isMuted; 
        await updateDoc(doc(db,'users',u), {isMuted:!curr}); 
        alert(curr?'Размучен':'Замучен'); 
    },
    
    warn: async (u) => { 
        const r = prompt('Причина предупреждения?'); 
        if(r) {
            await window.app.notify(u, 'warn', 'АДМИН: '+r); 
            alert('Предупреждение отправлено');
        }
    },
    
    toggleAdmin: async (u, curr) => { 
        if(confirm(curr ? 'Снять админку?' : 'Выдать админку?')) {
            await updateDoc(doc(db,'users',u), {isAdmin:!curr}); 
            alert('Права обновлены'); 
        }
    },
    
    delAcc: async (u) => { 
        if(confirm('УДАЛИТЬ АККАУНТ ПОЛНОСТЬЮ? ЭТО НЕОБРАТИМО.')) { 
            await deleteDoc(doc(db,'users',u)); 
            alert('Аккаунт удален'); 
        } 
    },
    
    loadModQueue: async () => {
        const s = await getDocs(query(collection(db,'posts'), where('approved','==',false)));
        const c = document.getElementById('adm-content'); c.innerHTML='';
        if(s.empty) c.innerHTML='<h3>Нет постов на проверку</h3>';
        
        s.forEach(d => {
            const p = d.data();
            const actionInfo = p.actionBtn ? `<br><b>Кнопка:</b> [${p.actionBtn.text}] -> ${p.actionBtn.link}` : '';
            
            c.innerHTML += `<div class="card" style="border:2px solid orange">
                <b>${p.author}</b><br>${p.content}<br>
                ${p.image ? `<img src="${p.image}" width="100">` : ''}
                ${actionInfo}
                <div style="margin-top:10px; display:flex; gap:10px;">
                    <button class="action-btn sm-btn" onclick="window.admin.approve('${d.id}')">✅ ОДОБРИТЬ</button>
                    <button class="action-btn btn-danger sm-btn" onclick="window.admin.reject('${d.id}')">❌ УДАЛИТЬ</button>
                </div>
            </div>`;
        });
    },
    
    approve: async (id) => { await updateDoc(doc(db,'posts',id), {approved:true}); window.admin.loadModQueue(); },
    reject: async (id) => { await deleteDoc(doc(db,'posts',id)); window.admin.loadModQueue(); },
    
    loadV: async () => {
        const s = await getDocs(query(collection(db,'system','verifications','requests'), where('status','==','pending')));
        const c = document.getElementById('adm-content'); c.innerHTML='';
        if(s.empty) c.innerHTML='<h3>Нет заявок</h3>';
        
        s.forEach(d => {
            const r = d.data();
            c.innerHTML += `<div class="card">
                <b>${r.username}</b><br>ФИО: ${r.realname}<br>Инфо: ${r.reason}<br>Links: ${r.links}
                <div style="margin-top:10px;">
                    <button class="action-btn sm-btn" onclick="window.admin.okV('${d.id}','${r.username}')">ВЫДАТЬ</button>
                    <button class="action-btn btn-danger sm-btn" onclick="window.admin.noV('${d.id}')">ОТКАЗАТЬ</button>
                </div>
            </div>`;
        });
    },
    
    okV: async (id, u) => { 
        await updateDoc(doc(db,'users',u), {isVerified:true}); 
        await updateDoc(doc(db,'system','verifications','requests',id), {status:'ok'}); 
        window.admin.loadV(); 
    },
    
    noV: async (id) => { 
        await updateDoc(doc(db,'system','verifications','requests',id), {status:'no'}); 
        window.admin.loadV(); 
    }
};

window.app.init();
