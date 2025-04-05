document.addEventListener('DOMContentLoaded', () => {
    // --- Constants and Variables ---
    const API_BASE_URL = ''; // Assuming Flask serves JS relative to root
    const eventList = document.getElementById('eventList');
    const dashboardEventList = document.getElementById('dashboardEventList');
    const addEventForm = document.getElementById('addEventForm');
    const saveNewEventBtn = document.getElementById('saveNewEventBtn');
    const editEventForm = document.getElementById('editEventForm');
    const saveEditedEventBtn = document.getElementById('saveEditedEventBtn');
    const addEventModalEl = document.getElementById('addEventModal');
    const editEventModalEl = document.getElementById('editEventModal');
    const addEventModal = new bootstrap.Modal(addEventModalEl);
    const editEventModal = new bootstrap.Modal(editEventModalEl);
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorMessage = document.getElementById('errorMessage');
    const errorMessageText = document.getElementById('errorMessageText');
    const noEventsMessage = document.getElementById('noEvents');
    const noDashboardEventsMessage = document.getElementById('noDashboardEvents');

    const navAllEvents = document.getElementById('nav-all-events');
    const navDashboard = document.getElementById('nav-dashboard');
    const allEventsView = document.getElementById('allEventsView');
    const dashboardView = document.getElementById('dashboardView');
    const themeSwitch = document.getElementById('themeSwitch');

    // Filter & Pagination Elements
    const filterForm = document.getElementById('filterForm');
    const filterNameInput = document.getElementById('filterName');
    const filterPersonInput = document.getElementById('filterPerson');
    const filterCreatedDateInput = document.getElementById('filterCreatedDate');
    // const filterUpdatedDateInput = document.getElementById('filterUpdatedDate'); // If added back
    const itemsPerPageSelect = document.getElementById('itemsPerPage');
    const applyFiltersBtn = document.getElementById('applyFiltersBtn');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const paginationControls = document.getElementById('paginationControls');

    // Datalist Elements
    const addResponsiblePersonsList = document.getElementById('addResponsiblePersonsList');
    const editResponsiblePersonsList = document.getElementById('editResponsiblePersonsList');
    const filterResponsiblePersonsList = document.getElementById('filterResponsiblePersonsList');


    // State Variables
    let currentView = 'dashboard'; // Default view remains dashboard
    let allEventsCurrentPage = 1;
    let allEventsItemsPerPage = 10;
    let currentFilters = {}; // Store active filters
    let liveTimerInterval = null; // Interval ID for live timers
    let flatpickrInstances = {}; // To store date picker instances

    // --- Utility Functions ---
    function showLoading() {
        loadingIndicator.style.display = 'flex';
        // Don't clear content here, let the rendering functions handle it after fetch
        noEventsMessage.style.display = 'none';
        noDashboardEventsMessage.style.display = 'none';
        paginationControls.innerHTML = ''; // Clear pagination while loading
    }

    function hideLoading() {
        loadingIndicator.style.display = 'none';
    }

    function showError(message) {
        errorMessageText.textContent = message;
        errorMessage.style.display = 'block';
        // Auto-dismiss after a delay? Optional.
        // setTimeout(() => {
        //     if (errorMessage.style.display === 'block') {
        //         bootstrap.Alert.getOrCreateInstance(errorMessage).close();
        //     }
        // }, 5000);
        // Ensure close button works
        const bsAlert = bootstrap.Alert.getOrCreateInstance(errorMessage);
        errorMessage.addEventListener('closed.bs.alert', () => {
            errorMessage.style.display = 'none';
        }, {once: true});
    }

    function formatDuration(totalSeconds) {
        if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds) || totalSeconds < 0) {
            return 'N/A';
        }
        totalSeconds = Math.floor(totalSeconds);

        if (totalSeconds === 0) {
            return '0秒'; // Show 0秒 explicitly
        }

        const days = Math.floor(totalSeconds / (3600 * 24));
        const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        let parts = [];
        if (days > 0) {
            parts.push(`${days}天`);
        }
        if (hours > 0) {
            // Pad hours only if days are also shown
            // parts.push(`${days > 0 ? String(hours).padStart(2, '0') : hours}时`);
            parts.push(`${hours}时`); // Simpler: Don't pad hours
        }
        if (minutes > 0) {
            // Pad minutes only if hours (or days) are shown
            parts.push(`${(days > 0 || hours > 0) ? String(minutes).padStart(2, '0') : minutes}分`);
        }
        if (seconds >= 0) { // Always show seconds if other units are present, or if it's the only unit
            // Pad seconds only if other units are shown
            if (days > 0 || hours > 0 || minutes > 0 || totalSeconds < 60) { // Show seconds if other units or total < 1 min
                parts.push(`${(days > 0 || hours > 0 || minutes > 0) ? String(seconds).padStart(2, '0') : seconds}秒`);
            }
        }

        return parts.join(' '); // Join with space
    }

    function formatDateTime(dateString) {
        if (!dateString) return 'N/A';
        try {
            // Assuming dateString is ISO 8601 format from Python
            const date = new Date(dateString);
            if (isNaN(date.getTime())) { // Check for invalid date object
                return 'Invalid Date';
            }
            // Use Intl.DateTimeFormat for better locale support and options
            const options = {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false // Use 24-hour format
            };
            return new Intl.DateTimeFormat(navigator.language || 'zh-CN', options).format(date);
        } catch (e) {
            console.error("Error formatting date:", dateString, e);
            return 'Invalid Date';
        }
    }

    // --- API Call Functions ---
    async function fetchApi(url, options = {}) {
        // showLoading() / hideLoading() are handled by the calling context (e.g., refreshCurrentView)
        try {
            const response = await fetch(API_BASE_URL + url, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...options.headers,
                },
                ...options,
            });

            const contentType = response.headers.get("content-type");
            let responseData;

            if (response.status === 204) { // No Content
                return {message: "Operation successful (No Content)"};
            } else if (contentType && contentType.includes("application/json")) {
                responseData = await response.json();
            } else {
                const errorText = await response.text();
                responseData = {error: errorText || `Unexpected response type: ${contentType}, Status: ${response.status}`};
            }

            if (!response.ok) {
                console.error("API Error Response:", responseData);
                // Use detailed error from server if available
                const errorMsg = responseData.error || (responseData.message ? `Server error: ${responseData.message}` : `Request failed: ${response.status} ${response.statusText}`);
                throw new Error(errorMsg);
            }

            return responseData;

        } catch (error) {
            console.error('API Fetch Error:', error);
            // Display the specific error message thrown or a generic one
            showError(error.message || '网络请求失败，请检查连接或稍后重试。');
            throw error; // Re-throw for the calling function to handle
        }
    }

    // --- Render Functions ---
    function renderEventRow(event) {
        const tr = document.createElement('tr');
        tr.setAttribute('data-event-id', event.event_id);
        // Add data attributes needed for live timer
        if (event.event_status === 1 && event.last_start_time) {
            tr.setAttribute('data-status', 'running');
            tr.setAttribute('data-last-start-time', event.last_start_time);
            tr.setAttribute('data-initial-duration', event.total_duration_seconds);
        } else {
            tr.setAttribute('data-status', 'stopped');
        }

        tr.innerHTML = `
            <td class="text-center">
                <span class="status-indicator ${event.event_status === 1 ? 'running' : 'stopped'}"
                      title="${event.event_status === 1 ? '进行中' : '已停止'}"></span>
                <i class="fas fa-star star-icon ${event.event_mark_status === 1 ? 'marked' : 'unmarked'}"
                   title="${event.event_mark_status === 1 ? '取消关注' : '标记关注'}"
                   data-event-id="${event.event_id}"
                   data-marked="${event.event_mark_status}"></i>
            </td>
            <td>
                <strong class="event-name">${event.event_name || 'N/A'}</strong>
                <p class="text-muted small mb-0 event-desc">${event.event_desc || ''}</p>
            </td>
            <td class="duration-display font-monospace">${formatDuration(event.total_duration_seconds)}</td>
            <td class="text-nowrap action-buttons">
                <button class="btn btn-sm ${event.event_status === 1 ? 'btn-outline-warning' : 'btn-outline-success'} btn-action start-stop-btn"
                        data-event-id="${event.event_id}" data-action="${event.event_status === 1 ? 'stop' : 'start'}">
                    <i class="fas ${event.event_status === 1 ? 'fa-stop-circle' : 'fa-play-circle'} fa-fw"></i>
                    <span>${event.event_status === 1 ? '停止' : '开始'}</span>
                </button>
                <button class="btn btn-sm btn-outline-primary btn-action edit-btn" data-bs-toggle="modal" data-bs-target="#editEventModal" data-event-id="${event.event_id}">
                    <i class="fas fa-edit fa-fw"></i> <span>编辑</span>
                </button>
                <button class="btn btn-sm btn-outline-danger btn-action delete-btn" data-event-id="${event.event_id}">
                    <i class="fas fa-trash-alt fa-fw"></i> <span>删除</span>
                </button>
            </td>
            <td class="responsible-person text-muted">${event.responsible_person || '-'}</td>
            <td class="create-time text-muted small">${formatDateTime(event.create_time)}</td>
            <td class="update-time text-muted small">${formatDateTime(event.update_time)}</td>
        `;

        // Attach event listeners (ensure query selectors are correct)
        tr.querySelector('.start-stop-btn').addEventListener('click', handleStartStop);
        tr.querySelector('.edit-btn').addEventListener('click', handleEdit); // Edit button needs modal target etc.
        tr.querySelector('.delete-btn').addEventListener('click', handleDelete);
        tr.querySelector('.star-icon').addEventListener('click', handleToggleMark);

        return tr;
    }

    function renderDashboardCard(event) {
        console.log("--- [调试] 进入 renderDashboardCard, 事件:", event.event_name); // <--- 添加
        const col = document.createElement('div');
        col.classList.add('col');
        col.setAttribute('data-event-id', event.event_id);
        // ... (设置 data-status, data-last-start-time 等属性) ...
        // --- VERIFY THIS BLOCK ---
        // 确保为正在运行的事件添加了所有必要的 data-* 属性
        if (event.event_status === 1 && event.last_start_time) {
            col.setAttribute('data-status', 'running');
            // 确保 event.last_start_time 是有效的 ISO 格式时间字符串
            col.setAttribute('data-last-start-time', event.last_start_time);
            // 确保 event.total_duration_seconds 是一个数字
            col.setAttribute('data-initial-duration', event.total_duration_seconds);
            console.log(`--- [调试 Card Timer Attr] Event ${event.event_id} - Setting running attributes:`, {
                start: event.last_start_time,
                initial: event.total_duration_seconds
            });
        } else {
            col.setAttribute('data-status', 'stopped');
        }

        // 检查关键数据是否存在
        const eventName = event.event_name || 'N/A';
        const eventDesc = event.event_desc || '无描述';
        const durationText = formatDuration(event.total_duration_seconds);
        const createTimeText = formatDateTime(event.create_time);
        const personText = event.responsible_person || '未分配';
        const isRunning = event.event_status === 1;

        col.innerHTML = `
        <div class="card dashboard-card h-100 ${isRunning ? 'running' : ''}">
            <div class="card-body d-flex flex-column">
                 <div class="d-flex justify-content-between align-items-start mb-2">
                     <h5 class="card-title mb-0 event-name">
                        <span class="status-indicator ${isRunning ? 'running' : 'stopped'}" title="${isRunning ? '进行中' : '已停止'}"></span>
                        ${eventName}
                     </h5>
                     <i class="fas fa-star star-icon marked flex-shrink-0 ms-2"
                        title="取消关注"
                        data-event-id="${event.event_id}"
                        data-marked="1"></i>
                 </div>
                 <p class="card-text small event-desc flex-grow-1">${eventDesc}</p>
                <div class="mt-auto pt-2">
                     <div class="d-flex justify-content-between align-items-baseline mb-2">
                        <span class="text-muted small responsible-person"><i class="fas fa-user fa-fw me-1"></i>${personText}</span>
                         <span class="duration-display font-monospace text-end fw-bold">${durationText}</span>
                     </div>
                     <button class="btn w-100 ${isRunning ? 'btn-warning' : 'btn-success'} start-stop-btn"
                             data-event-id="${event.event_id}" data-action="${isRunning ? 'stop' : 'start'}">
                         <i class="fas ${isRunning ? 'fa-stop-circle' : 'fa-play-circle'} me-1"></i>
                         <span>${isRunning ? '停止计时' : '开始计时'}</span>
                     </button>
                </div>
            </div>
            <div class="card-footer text-muted small">
                创建于: ${createTimeText}
            </div>
        </div>
    `;
        console.log("--- [调试] renderDashboardCard 生成的 HTML (部分):", col.innerHTML.substring(0, 100) + "..."); // <--- 添加
        // ... (添加事件监听器) ...
        // 确保事件监听器正确添加
        try {
            col.querySelector('.start-stop-btn').addEventListener('click', handleStartStop);
            col.querySelector('.star-icon').addEventListener('click', handleToggleMark);
        } catch (listenerError) {
            console.error("--- [调试] 添加事件监听器出错:", listenerError, "事件:", event.event_name);
        }

        return col; // 确保返回了创建的元素
    }

    function renderPaginationControls(currentPage, totalPages, itemsPerPage) {
        paginationControls.innerHTML = ''; // Clear existing controls
        if (totalPages <= 1) return; // No controls needed for 0 or 1 page

        const fragment = document.createDocumentFragment();

        // Previous Button
        const prevLi = document.createElement('li');
        prevLi.classList.add('page-item');
        if (currentPage === 1) prevLi.classList.add('disabled');
        prevLi.innerHTML = `<a class="page-link" href="#" aria-label="Previous" data-page="${currentPage - 1}"><span aria-hidden="true">«</span></a>`;
        fragment.appendChild(prevLi);

        // Page Number Buttons (simplified logic, show ellipsis for many pages)
        const maxPagesToShow = 5; // Max number links shown around current page
        let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
        let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

        // Adjust if we are near the end
        if (endPage - startPage + 1 < maxPagesToShow) {
            startPage = Math.max(1, endPage - maxPagesToShow + 1);
        }

        if (startPage > 1) {
            const firstLi = document.createElement('li');
            firstLi.classList.add('page-item');
            firstLi.innerHTML = `<a class="page-link" href="#" data-page="1">1</a>`;
            fragment.appendChild(firstLi);
            if (startPage > 2) {
                const ellipsisLi = document.createElement('li');
                ellipsisLi.classList.add('page-item', 'disabled');
                ellipsisLi.innerHTML = `<span class="page-link">...</span>`;
                fragment.appendChild(ellipsisLi);
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const pageLi = document.createElement('li');
            pageLi.classList.add('page-item');
            if (i === currentPage) pageLi.classList.add('active');
            pageLi.innerHTML = `<a class="page-link" href="#" data-page="${i}">${i}</a>`;
            fragment.appendChild(pageLi);
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                const ellipsisLi = document.createElement('li');
                ellipsisLi.classList.add('page-item', 'disabled');
                ellipsisLi.innerHTML = `<span class="page-link">...</span>`;
                fragment.appendChild(ellipsisLi);
            }
            const lastLi = document.createElement('li');
            lastLi.classList.add('page-item');
            lastLi.innerHTML = `<a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a>`;
            fragment.appendChild(lastLi);
        }


        // Next Button
        const nextLi = document.createElement('li');
        nextLi.classList.add('page-item');
        if (currentPage === totalPages) nextLi.classList.add('disabled');
        nextLi.innerHTML = `<a class="page-link" href="#" aria-label="Next" data-page="${currentPage + 1}"><span aria-hidden="true">»</span></a>`;
        fragment.appendChild(nextLi);

        paginationControls.appendChild(fragment);

        // Add event listeners to the newly created links
        paginationControls.querySelectorAll('.page-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const pageNum = parseInt(link.dataset.page);
                if (!isNaN(pageNum) && pageNum !== allEventsCurrentPage && !link.closest('.page-item').classList.contains('disabled')) {
                    goToPage(pageNum);
                }
            });
        });
    }

    // --- Check Empty Messages ---
    function checkEmptyMessages(view, itemCount) {
        if (view === 'allEvents') {
            noEventsMessage.style.display = itemCount === 0 ? 'block' : 'none';
        } else if (view === 'dashboard') {
            noDashboardEventsMessage.style.display = itemCount === 0 ? 'block' : 'none';
        }
    }

    // --- Live Timer Functions ---
    function startLiveTimers() {
        clearInterval(liveTimerInterval); // Clear previous interval
        // Find elements that need live updates (both table rows and dashboard cards)
        const runningElements = document.querySelectorAll('[data-status="running"][data-last-start-time]');
        if (runningElements.length > 0) {
            liveTimerInterval = setInterval(() => updateRunningTimers(runningElements), 1000);
            updateRunningTimers(runningElements); // Update immediately
        }
    }

    function updateRunningTimers(elements) {
        const now = Date.now();
        elements.forEach(el => {
            const startTimeAttr = el.dataset.lastStartTime;
            const initialDurationAttr = el.dataset.initialDuration;
            const durationDisplay = el.querySelector('.duration-display');

            if (startTimeAttr && initialDurationAttr && durationDisplay) {
                try {
                    const startTime = new Date(startTimeAttr).getTime();
                    const initialDuration = parseFloat(initialDurationAttr);
                    if (!isNaN(startTime) && !isNaN(initialDuration)) {
                        const elapsedSeconds = Math.max(0, (now - startTime) / 1000);
                        const currentTotalSeconds = initialDuration + elapsedSeconds;
                        durationDisplay.textContent = formatDuration(currentTotalSeconds);
                    } else {
                        console.warn("Invalid time/duration data for timer:", el.dataset.eventId);
                        // Optionally stop timer for this element or display 'Error'
                    }
                } catch (e) {
                    console.error("Error calculating live time:", e);
                    // Optionally stop timer for this element
                }
            }
        });
    }

    // --- Event Handlers ---
    async function refreshCurrentView() {
        console.log(`Refreshing view: ${currentView} (Page: ${allEventsCurrentPage}, Limit: ${allEventsItemsPerPage})`, "Filters:", currentFilters);
        showLoading();
        errorMessage.style.display = 'none'; // Hide previous errors
        // Consider moving startLiveTimers() call to *after* data is loaded and rendered
        // clearInterval(liveTimerInterval); // Clear existing timers immediately

        try {
            if (currentView === 'allEvents') {
                await loadEventsData();
            } else if (currentView === 'dashboard') {
                await loadDashboardData();
                // !!! 不再需要在这里清空 !!!
            }
            // Start timers AFTER new data is potentially rendered in either view
            startLiveTimers();
        } catch (error) {
            console.error("Error refreshing view:", error);
            // Error message is shown by fetchApi
            // Ensure lists are cleared if error occurred during fetch/render
            if (currentView === 'allEvents') eventList.innerHTML = '';
            if (currentView === 'dashboard') dashboardEventList.innerHTML = ''; // Keep clear on error
        } finally {
            hideLoading();
            // Empty message check is now handled within load functions
        }
    }

    async function loadEventsData() {
        eventList.innerHTML = ''; // Clear previous results

        // Construct query parameters
        const params = new URLSearchParams({
            page: allEventsCurrentPage,
            limit: allEventsItemsPerPage,
            ...currentFilters // Spread the current filters
        });

        try {
            const data = await fetchApi(`/api/events?${params.toString()}`);
            if (data && data.events) {
                const fragment = document.createDocumentFragment();
                data.events.forEach(event => {
                    fragment.appendChild(renderEventRow(event));
                });
                eventList.appendChild(fragment);

                // Render pagination using the returned pagination info
                renderPaginationControls(data.pagination.current_page, data.pagination.total_pages, data.pagination.items_per_page);
                checkEmptyMessages('allEvents', data.events.length);
            } else {
                // Handle cases where API returns success but no 'events' array
                console.warn("Received data but no events array:", data);
                checkEmptyMessages('allEvents', 0);
                paginationControls.innerHTML = ''; // Clear pagination if no events
            }
        } catch (error) {
            // Error display handled by fetchApi
            // Ensure list is cleared on error
            eventList.innerHTML = '';
            paginationControls.innerHTML = '';
            checkEmptyMessages('allEvents', 0); // Show empty message on error too
        }
        // finally block handled by refreshCurrentView
    }

    async function loadDashboardData() {
        dashboardEventList.innerHTML = ''; // 清空之前的卡片
        console.log("--- [调试] 开始加载仪表盘数据 ---"); // <--- 添加
        try {
            const dashboardEvents = await fetchApi('/api/dashboard');
            console.log("--- [调试] /api/dashboard 返回的数据:", dashboardEvents); // <--- 添加 - 检查收到的数据

            if (dashboardEvents && dashboardEvents.length > 0) {
                console.log(`--- [调试] 准备渲染 ${dashboardEvents.length} 个仪表盘卡片 ---`); // <--- 添加
                const fragment = document.createDocumentFragment();
                dashboardEvents.forEach(event => {
                    console.log("--- [调试] 正在为事件渲染卡片:", event.event_name, event); // <--- 添加 - 检查单个事件
                    try { // 加个 try...catch 以防 render 函数内部出错
                        const cardElement = renderDashboardCard(event);
                        if (cardElement) { // 确保 render 函数返回了元素
                            fragment.appendChild(cardElement);
                        } else {
                            console.error("--- [调试] renderDashboardCard 返回了 null 或 undefined，事件:", event);
                        }
                    } catch (renderError) {
                        console.error("--- [调试] renderDashboardCard 内部出错:", renderError, "事件:", event);
                    }
                });
                dashboardEventList.appendChild(fragment);
                console.log(`--- [调试] 添加卡片为： ${fragment} ---`);
                console.log("--- [调试] 已将卡片添加到 dashboardEventList ---"); // <--- 添加 - 确认追加操作执行
            } else {
                console.log("--- [调试] API 未返回有效的仪表盘事件数据 ---"); // <--- 添加
            }
            checkEmptyMessages('dashboard', dashboardEvents ? dashboardEvents.length : 0);
            startLiveTimers(); // 确保计时器在渲染后启动
        } catch (error) {
            console.error("--- [调试] loadDashboardData 函数出错:", error); // <--- 添加 - 捕获此函数内的错误
            // checkEmptyMessages('dashboard', 0);
        }
        console.log("--- [调试] loadDashboardData 执行完毕 ---"); // <--- 添加
    }

    // --- Responsible Person Handling ---
    async function loadResponsiblePersons() {
        try {
            const persons = await fetchApi('/api/persons');
            if (Array.isArray(persons)) {
                const fragment = document.createDocumentFragment();
                persons.forEach(person => {
                    const option = document.createElement('option');
                    option.value = person;
                    fragment.appendChild(option);
                });

                // Clear existing options before appending
                addResponsiblePersonsList.innerHTML = '';
                editResponsiblePersonsList.innerHTML = '';
                filterResponsiblePersonsList.innerHTML = ''; // Clear filter list first

                // Add specific options to filter list
                const allOption = document.createElement('option');
                allOption.value = ''; // Empty value means "All"
                // allOption.textContent = '所有人'; // Optional text, placeholder works better
                filterResponsiblePersonsList.appendChild(allOption);

                const unassignedOption = document.createElement('option');
                unassignedOption.value = '__unassigned__'; // Special value for backend
                unassignedOption.textContent = '未分配';
                filterResponsiblePersonsList.appendChild(unassignedOption);


                // Append fetched persons
                filterResponsiblePersonsList.appendChild(fragment.cloneNode(true)); // Clone for filter
                addResponsiblePersonsList.appendChild(fragment.cloneNode(true)); // Clone for add modal
                editResponsiblePersonsList.appendChild(fragment); // Use original for edit modal
            }
        } catch (error) {
            console.error("Failed to load responsible persons:", error);
            showError("无法加载负责人列表");
        }
    }


    // --- Modal and Form Handlers ---
    saveNewEventBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('addEventName');
        const name = nameInput.value.trim();
        const desc = document.getElementById('addEventDesc').value.trim();
        // Get value from the input associated with the datalist
        const person = document.getElementById('addResponsiblePerson').value.trim();

        nameInput.classList.remove('is-invalid');
        if (!name) {
            nameInput.classList.add('is-invalid');
            // showError("事件名称不能为空"); // Error shown by browser validation ideally
            nameInput.focus();
            return;
        }

        const newEventData = {
            event_name: name,
            event_desc: desc,
            // Send null if person is empty, otherwise send the value
            responsible_person: person || null
        };
        console.log("Submitting new event:", newEventData);
        saveNewEventBtn.disabled = true;
        showLoading(); // Show loading during the operation

        try {
            const createdEvent = await fetchApi('/api/events', {method: 'POST', body: JSON.stringify(newEventData)});
            console.log("Event added:", createdEvent);
            addEventForm.reset(); // Reset form fields
            nameInput.classList.remove('is-invalid'); // Clear validation state
            addEventModal.hide(); // Hide modal on success
            await refreshCurrentView(); // Refresh the current view
            await loadResponsiblePersons(); // Refresh person list in case a new one was added
        } catch (error) {
            console.error("Failed to add event:", error);
            // Error message shown by fetchApi
            // Keep modal open for correction
        } finally {
            saveNewEventBtn.disabled = false; // Re-enable button
            hideLoading(); // Hide loading indicator
        }
    });

    saveEditedEventBtn.addEventListener('click', async () => {
        const id = document.getElementById('editEventId').value;
        const nameInput = document.getElementById('editEventName');
        const name = nameInput.value.trim();
        const desc = document.getElementById('editEventDesc').value.trim();
        // Get value from the input associated with the datalist
        const person = document.getElementById('editResponsiblePerson').value.trim();


        nameInput.classList.remove('is-invalid');
        if (!name) {
            nameInput.classList.add('is-invalid');
            // showError("事件名称不能为空");
            nameInput.focus();
            return;
        }
        if (!id) {
            showError("无法获取事件ID，请重试");
            return;
        }

        const updatedEventData = {
            event_name: name,
            event_desc: desc,
            responsible_person: person || null // Send null if empty
        };

        console.log(`Updating event ${id}:`, updatedEventData);
        saveEditedEventBtn.disabled = true;
        showLoading();

        try {
            const updatedEvent = await fetchApi(`/api/events/${id}`, {
                method: 'PUT',
                body: JSON.stringify(updatedEventData)
            });
            console.log("Event updated:", updatedEvent);
            editEventForm.reset(); // Reset form
            nameInput.classList.remove('is-invalid'); // Clear validation
            editEventModal.hide(); // Hide modal on success
            await refreshCurrentView(); // Refresh view
            await loadResponsiblePersons(); // Refresh person list
        } catch (error) {
            console.error(`Failed to update event ${id}:`, error);
            // Error message shown by fetchApi
            // Keep modal open
        } finally {
            saveEditedEventBtn.disabled = false;
            hideLoading();
        }
    });

    // Handle modal shown/hidden events (optional: clear forms on hide)
    addEventModalEl.addEventListener('hidden.bs.modal', () => {
        addEventForm.reset();
        document.getElementById('addEventName').classList.remove('is-invalid');
    });
    editEventModalEl.addEventListener('hidden.bs.modal', () => {
        editEventForm.reset();
        document.getElementById('editEventName').classList.remove('is-invalid');
    });


    // --- Action Button Handlers ---
    async function handleStartStop(event) {
        const button = event.currentTarget;
        const eventId = button.dataset.eventId;
        const action = button.dataset.action;
        const logType = action === 'start' ? 1 : 0;

        button.disabled = true;
        const buttonSpan = button.querySelector('span');
        const originalText = buttonSpan ? buttonSpan.textContent : '';
        const icon = button.querySelector('i');
        const originalIconClass = icon ? icon.className : '';

        // Provide immediate visual feedback
        if (buttonSpan) buttonSpan.textContent = action === 'start' ? '启动中...' : '停止中...';
        if (icon) icon.className = 'fas fa-spinner fa-spin fa-fw';
        // Optionally slightly dim the row/card
        const targetElement = button.closest('tr') || button.closest('.col');
        if (targetElement) targetElement.style.opacity = '0.7';


        try {
            // API call (loading indicator is the button state)
            const result = await fetchApi(`/api/events/${eventId}/log`, {
                method: 'POST',
                body: JSON.stringify({log_type: logType})
            });
            console.log(`Event ${eventId} ${action} result:`, result);
            // Success: Refresh the view to show updated status and time
            await refreshCurrentView(); // This will re-enable the button and reset opacity via re-render
        } catch (error) {
            console.error(`Failed to ${action} event ${eventId}:`, error);
            // Error: Revert button state and opacity
            button.disabled = false;
            if (buttonSpan) buttonSpan.textContent = originalText;
            if (icon) icon.className = originalIconClass;
            if (targetElement) targetElement.style.opacity = '1';
            // Error message is shown by fetchApi
        }
        // No finally block needed as refresh handles success state restore
    }

    async function handleEdit(event) {
        const button = event.currentTarget;
        const eventId = button.dataset.eventId;

        // Fetch fresh data for the modal to avoid using potentially stale DOM data
        showLoading(); // Show loading while fetching details
        try {
            const eventData = await fetchApi(`/api/events/${eventId}`);
            if (eventData && eventData.event_id) {
                document.getElementById('editEventId').value = eventData.event_id;
                document.getElementById('editEventName').value = eventData.event_name || '';
                document.getElementById('editEventDesc').value = eventData.event_desc || '';
                document.getElementById('editResponsiblePerson').value = eventData.responsible_person || ''; // Set to empty string if null/undefined
                document.getElementById('editEventName').classList.remove('is-invalid');

                // Ensure modal is shown *after* data is populated
                // (data-bs-toggle might show it too early otherwise)
                // If the button doesn't have data-bs-toggle, show it manually:
                if (!button.hasAttribute('data-bs-toggle')) {
                    editEventModal.show();
                }
            } else {
                throw new Error("无法加载事件详情");
            }
        } catch (error) {
            console.error(`Failed to fetch details for event ${eventId}:`, error);
            // Error shown by fetchApi
            // Don't show the modal if data fetch failed
            editEventModal.hide(); // Ensure it's hidden if it was somehow shown
        } finally {
            hideLoading();
        }
    }


    async function handleDelete(event) {
        const button = event.currentTarget;
        const eventId = button.dataset.eventId;
        let eventName = `ID ${eventId}`; // Default name
        const row = button.closest('tr');
        const cardCol = button.closest('.col'); // Dashboard card uses .col

        // Try to get a more descriptive name from the DOM
        const nameElement = row ? row.querySelector('.event-name') : (cardCol ? cardCol.querySelector('.event-name') : null);
        if (nameElement) {
            // Clone the element to avoid modifying the original during text extraction
            const nameElementClone = nameElement.cloneNode(true);
            // Remove the status indicator span if it exists inside
            const statusIndicator = nameElementClone.querySelector('.status-indicator');
            if (statusIndicator) {
                statusIndicator.remove();
            }
            eventName = nameElementClone.textContent.trim() || eventName;
        }


        if (confirm(`确定要删除事件 "${eventName}" 吗？\n（此操作会将事件标记为已删除，但不会永久移除数据）`)) {
            const targetElement = row || cardCol;
            if (targetElement) targetElement.style.opacity = '0.4'; // Visual feedback
            button.disabled = true; // Disable delete button

            try {
                // API call (no separate loading indicator, opacity is feedback)
                await fetchApi(`/api/events/${eventId}`, {method: 'DELETE'});
                console.log(`Event ${eventId} marked as deleted.`);
                // Success: Refresh the view
                await refreshCurrentView();
            } catch (error) {
                console.error(`Failed to delete event ${eventId}:`, error);
                // Error: Revert visual feedback and button state
                if (targetElement) targetElement.style.opacity = '1';
                button.disabled = false;
                // Error message shown by fetchApi
            }
        }
    }

    async function handleToggleMark(event) {
        const icon = event.currentTarget;
        const eventId = icon.dataset.eventId;
        const currentMarkedStatus = parseInt(icon.dataset.marked);
        const newMarkedStatus = currentMarkedStatus === 1 ? 0 : 1;

        const originalIconClass = icon.className;
        icon.className = 'fas fa-spinner fa-spin star-icon'; // Loading state
        icon.style.color = 'inherit'; // Prevent spinner inheriting star color

        try {
            const updatedEvent = await fetchApi(`/api/events/${eventId}`, {
                method: 'PUT',
                body: JSON.stringify({event_mark_status: newMarkedStatus}),
            });
            console.log(`Event ${eventId} mark status toggled:`, updatedEvent);
            // Success: Refresh the view
            await refreshCurrentView();
        } catch (error) {
            console.error(`Failed to toggle mark status for event ${eventId}:`, error);
            // Error: Revert icon state
            icon.className = originalIconClass;
            // Error message shown by fetchApi
        }
    }

    // --- Filter and Pagination Logic ---
    function applyFilters() {
        const name = filterNameInput.value.trim();
        const person = filterPersonInput.value.trim(); // Use the special '__unassigned__' value if selected
        const createdDateRange = flatpickrInstances.created ? flatpickrInstances.created.selectedDates : [];
        // const updatedDateRange = flatpickrInstances.updated ? flatpickrInstances.updated.selectedDates : []; // If added back

        currentFilters = {}; // Reset filters object

        if (name) currentFilters.search_name = name;
        if (person) currentFilters.search_person = person; // Backend handles '__unassigned__'

        if (createdDateRange.length > 0) {
            // Format dates as YYYY-MM-DD for backend
            currentFilters.search_created_after = flatpickr.formatDate(createdDateRange[0], "Y-m-d");
            if (createdDateRange.length > 1) {
                currentFilters.search_created_before = flatpickr.formatDate(createdDateRange[1], "Y-m-d");
            } else {
                // If only one date selected, filter for that single day
                currentFilters.search_created_before = currentFilters.search_created_after;
            }
        }
        // Add updated date filters if using
        // if (updatedDateRange.length > 0) { ... }


        console.log("Applying filters:", currentFilters);
        allEventsCurrentPage = 1; // Reset to first page when filters change
        refreshCurrentView();
    }

    function clearFilters() {
        filterForm.reset(); // Reset form inputs
        // Reset flatpickr date pickers
        if (flatpickrInstances.created) flatpickrInstances.created.clear();
        // if (flatpickrInstances.updated) flatpickrInstances.updated.clear(); // If added back
        currentFilters = {}; // Clear stored filters
        allEventsCurrentPage = 1; // Reset to first page
        allEventsItemsPerPage = parseInt(itemsPerPageSelect.value) || 10; // Reset items per page from select
        console.log("Filters cleared");
        refreshCurrentView();
    }

    function goToPage(pageNumber) {
        if (pageNumber >= 1) {
            allEventsCurrentPage = pageNumber;
            refreshCurrentView();
        }
    }

    // Filter Event Listeners
    filterForm.addEventListener('submit', (e) => {
        e.preventDefault(); // Prevent default form submission
        applyFilters();
    });

    clearFiltersBtn.addEventListener('click', clearFilters);

    itemsPerPageSelect.addEventListener('change', () => {
        allEventsItemsPerPage = parseInt(itemsPerPageSelect.value) || 10;
        allEventsCurrentPage = 1; // Go to page 1 when changing items per page
        refreshCurrentView();
    });


    // --- Navigation ---
    function switchView(view) {
        console.log("Switching view to:", view);
        if (view === 'dashboard') {
            allEventsView.style.display = 'none';
            dashboardView.style.display = 'block';
            navAllEvents.classList.remove('active');
            navDashboard.classList.add('active');
            currentView = 'dashboard';
        } else { // 'allEvents'
            dashboardView.style.display = 'none';
            allEventsView.style.display = 'block';
            navDashboard.classList.remove('active');
            navAllEvents.classList.add('active');
            currentView = 'allEvents';
            // Reset page/filters when switching TO all events? Optional, maybe keep state.
            // allEventsCurrentPage = 1;
            // currentFilters = {};
            // filterForm.reset();
            // if (flatpickrInstances.created) flatpickrInstances.created.clear();
        }
        refreshCurrentView(); // Refresh the newly selected view
    }

    // Navigation Event Listeners
    navAllEvents.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentView !== 'allEvents') {
            switchView('allEvents');
        }
    });

    navDashboard.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentView !== 'dashboard') {
            switchView('dashboard');
        }
    });

    // --- Theme Switch ---
    function updateThemeIcon(isDark) {
        const icon = themeSwitch.nextElementSibling.querySelector('i');
        if (isDark) {
            icon.className = 'fas fa-sun'; // Sun icon for dark mode (to switch to light)
            themeSwitch.nextElementSibling.setAttribute('title', '切换到浅色模式');
        } else {
            icon.className = 'fas fa-moon'; // Moon icon for light mode (to switch to dark)
            themeSwitch.nextElementSibling.setAttribute('title', '切换到深色模式');
        }
    }

    themeSwitch.addEventListener('change', function () {
        const isDark = this.checked;
        const theme = isDark ? 'dark' : 'light';
        document.documentElement.setAttribute('data-bs-theme', theme);
        localStorage.setItem('theme', theme);
        updateThemeIcon(isDark);
        // Optional: Force redraw or update components that might not auto-update theme
        // e.g., if chart libraries are used and need theme re-initialization.
    });

    // --- Date Picker Initialization ---
    function initializeDatePickers() {
        const commonOptions = {
            mode: "range",
            dateFormat: "Y-m-d", // Match backend expectation
            locale: "zh", // Use Chinese locale
            altInput: true, // Show user-friendly format
            altFormat: "Y 年 m 月 d 日",
            onChange: function (selectedDates, dateStr, instance) {
                // You could trigger filtering immediately on change, or wait for Apply button
                // console.log("Date changed:", dateStr);
            }
        };

        flatpickrInstances.created = flatpickr("#filterCreatedDate", commonOptions);
        // if using updated date filter:
        // flatpickrInstances.updated = flatpickr("#filterUpdatedDate", commonOptions);
        console.log("Date pickers initialized.");
    }


    // --- Initial Load ---
    async function initializeApp() {
        console.log("Initializing application...");
        showLoading();

        // 1. Set Theme
        const storedTheme = localStorage.getItem('theme') || 'dark'; // Default to dark
        const isInitiallyDark = storedTheme === 'dark';
        document.documentElement.setAttribute('data-bs-theme', storedTheme);
        themeSwitch.checked = isInitiallyDark;
        updateThemeIcon(isInitiallyDark);

        // 2. Initialize Date Pickers
        initializeDatePickers();

        // 3. Load dynamic data (responsible persons)
        await loadResponsiblePersons();

        // 4. Set initial view based on `currentView` state variable
        // Ensure HTML matches the default `currentView = 'dashboard'`
        if (currentView === 'dashboard') {
            allEventsView.style.display = 'none';
            dashboardView.style.display = 'block';
            navAllEvents.classList.remove('active');
            navDashboard.classList.add('active');
        } else {
            dashboardView.style.display = 'none';
            allEventsView.style.display = 'block';
            navDashboard.classList.remove('active');
            navAllEvents.classList.add('active');
        }

        // 5. Load data for the initial view
        await refreshCurrentView(); // This handles loading indicator hide

        console.log("Application initialized.");
    }

    // Start the application initialization process
    initializeApp();


}); // End DOMContentLoaded
