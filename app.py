import os
import math
import mysql.connector
from flask import Flask, request, jsonify, render_template
from datetime import datetime
from decimal import Decimal # 用于精确计算
from flask_cors import CORS

app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app) # 允许跨域请求，方便本地开发

# --- 数据库配置 ---
# !!! 警告：生产环境不要硬编码密码 !!!
DB_CONFIG = {
    'user': 'root',
    'password': '123',
    'host': 'localhost', # 或者你的 MariaDB 服务器 IP
    'port': 3306,
    'database': 'network_behavior_analysis',
    'raise_on_warnings': True,
    'use_pure': False, # 使用 C 实现，如果安装了的话
    'connection_timeout': 10 # Added connection timeout
}

# --- 数据库连接辅助函数 ---
def get_db_connection():
    """获取数据库连接和游标"""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        # print("Database connection successful") # Debug
        return conn
    except mysql.connector.Error as err:
        print(f"Error connecting to database: {err}")
        # 可以进一步处理错误，比如记录日志或抛出异常
        return None

# --- 辅助函数：更新统计信息 (No changes needed here based on requests) ---
def update_event_statistics(cursor, event_id, log_type, log_time):
    """
    根据日志更新事件统计信息。
    log_type: 1 for start, 0 for stop
    log_time: datetime object for the log entry
    """
    try:
        # 使用字典游标获取
        cursor.execute("SELECT stat_id, last_start_time, total_duration_seconds, event_status FROM event_statistics WHERE event_id = %s", (event_id,))
        stat_record_dict = cursor.fetchone() # Fetch as dict

        if log_type == 1: # 事件开始
            if stat_record_dict:
                # 更新现有记录
                cursor.execute("""
                    UPDATE event_statistics
                    SET last_start_time = %s, event_status = 1
                    WHERE event_id = %s
                """, (log_time, event_id))
            else:
                # 创建新记录
                cursor.execute("""
                    INSERT INTO event_statistics (event_id, last_start_time, event_status)
                    VALUES (%s, %s, 1)
                """, (event_id, log_time))

        elif log_type == 0: # 事件结束
            if stat_record_dict:
                last_start_time = stat_record_dict.get('last_start_time')
                total_duration_seconds = stat_record_dict.get('total_duration_seconds') # This might be Decimal, int, or None
                event_status = stat_record_dict.get('event_status')

                duration_increment = Decimal(0) # Initialize as Decimal zero
                # 只有在事件是 '进行中' 状态且有合法的 'last_start_time' 时才计算增量
                if event_status == 1 and last_start_time:
                    # Ensure log_time and last_start_time are datetime objects
                    # Assuming they are already datetime objects from the call
                    if isinstance(log_time, datetime) and isinstance(last_start_time, datetime):
                        time_difference = log_time - last_start_time
                        # Use Decimal for precision from the start
                        duration_increment = Decimal(max(0, time_difference.total_seconds()))
                    else:
                         print(f"Warning: Invalid datetime types for duration calculation. log_time: {type(log_time)}, last_start_time: {type(last_start_time)}")

                # Ensure both operands are Decimal before adding
                current_total_decimal = Decimal(total_duration_seconds or 0)
                new_total_duration = current_total_decimal + duration_increment


                cursor.execute("""
                    UPDATE event_statistics
                    SET last_stop_time = %s,
                        total_duration_seconds = %s,
                        event_status = 0
                    WHERE event_id = %s
                """, (log_time, new_total_duration, event_id))
            else:
                # If no statistics record exists when stopping, handle appropriately
                print(f"Warning: Stop log received for event_id {event_id} without a statistics record or prior start.")
                # Decide policy: create a record with 0 duration or log error?
                # Creating a record:
                cursor.execute("""
                    INSERT INTO event_statistics (event_id, last_stop_time, event_status, total_duration_seconds)
                    VALUES (%s, %s, 0, 0)
                    ON DUPLICATE KEY UPDATE
                    last_stop_time = VALUES(last_stop_time), event_status = VALUES(event_status)
                """, (event_id, log_time))

        return True
    except mysql.connector.Error as err:
        print(f"Error updating statistics for event {event_id}: {err}")
        return False
    except Exception as e:
        print(f"Unexpected error updating statistics: {e}")
        return False

# --- API Endpoints ---

# 1. 获取事件列表 (MODIFIED: Added Pagination, Filtering, Sorting)
@app.route('/api/events', methods=['GET'])
def get_events():
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor(dictionary=True) # 返回字典形式的结果

    try:
        # --- Pagination Parameters ---
        page = request.args.get('page', 1, type=int)
        limit = request.args.get('limit', 10, type=int) # Default 10 items per page
        if page < 1: page = 1
        if limit < 1: limit = 1
        offset = (page - 1) * limit

        # --- Filtering Parameters ---
        show_deleted = request.args.get('show_deleted', 'false').lower() == 'true'
        search_name = request.args.get('search_name', None, type=str)
        search_person = request.args.get('search_person', None, type=str)
        search_created_after = request.args.get('search_created_after', None, type=str)
        search_created_before = request.args.get('search_created_before', None, type=str)
        search_updated_after = request.args.get('search_updated_after', None, type=str)
        search_updated_before = request.args.get('search_updated_before', None, type=str)

        # --- Sorting Parameters ---
        sort_by = request.args.get('sort_by', 'create_time', type=str) # Default sort
        sort_order = request.args.get('sort_order', 'DESC', type=str).upper()

        # --- Build Query ---
        base_query = """
            FROM event_info e
            LEFT JOIN event_statistics s ON e.event_id = s.event_id
        """
        where_clauses = []
        params = []

        if not show_deleted:
            where_clauses.append("e.event_del_status = 1")

        if search_name:
            where_clauses.append("e.event_name LIKE %s")
            params.append(f"%{search_name}%")
        if search_person:
            # Allows filtering by 'unassigned' or specific person
            if search_person == '__unassigned__':
                 where_clauses.append("(e.responsible_person IS NULL OR e.responsible_person = '')")
            else:
                where_clauses.append("e.responsible_person = %s")
                params.append(search_person)

        # Add date range filters carefully
        if search_created_after:
            where_clauses.append("e.create_time >= %s")
            params.append(search_created_after)
        if search_created_before:
             # Add time component to make it inclusive of the whole day
            where_clauses.append("e.create_time < DATE_ADD(%s, INTERVAL 1 DAY)")
            params.append(search_created_before)
        if search_updated_after:
            where_clauses.append("e.update_time >= %s")
            params.append(search_updated_after)
        if search_updated_before:
             # Add time component to make it inclusive of the whole day
            where_clauses.append("e.update_time < DATE_ADD(%s, INTERVAL 1 DAY)")
            params.append(search_updated_before)


        where_sql = ""
        if where_clauses:
            where_sql = " WHERE " + " AND ".join(where_clauses)

        # --- Get Total Count for Pagination ---
        count_query = f"SELECT COUNT(*) as total {base_query} {where_sql}"
        cursor.execute(count_query, tuple(params))
        total_items = cursor.fetchone()['total']
        total_pages = math.ceil(total_items / limit) if limit > 0 else 0

        # --- Build Sorting ---
        allowed_sort_columns = {
            'name': 'e.event_name',
            'person': 'e.responsible_person',
            'create_time': 'e.create_time',
            'update_time': 'e.update_time',
            'status': 's.event_status',
            'duration': 's.total_duration_seconds'
        }
        sort_column_sql = allowed_sort_columns.get(sort_by, 'e.create_time') # Default to create_time if invalid
        sort_order_sql = "DESC" if sort_order == "DESC" else "ASC" # Sanitize sort order
        order_by_sql = f" ORDER BY {sort_column_sql} {sort_order_sql}, e.event_id {sort_order_sql}" # Add secondary sort for stability


        # --- Get Paginated Data ---
        data_query = f"""
            SELECT
                e.event_id, e.event_name, e.event_desc, e.create_time, e.update_time,
                e.responsible_person, e.event_del_status, e.event_mark_status,
                COALESCE(s.event_status, 0) as event_status,
                COALESCE(s.total_duration_seconds, 0) as total_duration_seconds,
                s.last_start_time, s.last_stop_time
            {base_query}
            {where_sql}
            {order_by_sql}
            LIMIT %s OFFSET %s
        """
        data_params = params + [limit, offset]
        cursor.execute(data_query, tuple(data_params))
        events = cursor.fetchall()

        # Format datetime and Decimal objects
        for event in events:
            for key, value in event.items():
                if isinstance(value, datetime):
                    event[key] = value.isoformat()
                if isinstance(value, Decimal):
                    event[key] = float(value)

        return jsonify({
            "events": events,
            "pagination": {
                "total_items": total_items,
                "total_pages": total_pages,
                "current_page": page,
                "items_per_page": limit
            }
        })
    except mysql.connector.Error as err:
        print(f"Error fetching events: {err}")
        return jsonify({"error": f"Failed to fetch events: {err}"}), 500
    except Exception as e:
        print(f"Unexpected error fetching events: {e}")
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


# 2. 创建新事件 (No changes needed based on requests)
@app.route('/api/events', methods=['POST'])
def add_event():
    data = request.get_json()
    if not data or not data.get('event_name'):
        return jsonify({"error": "Event name is required"}), 400

    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    # Use dictionary cursor to easily fetch and return the new event data
    cursor = conn.cursor(dictionary=True)
    try:
        sql = """
            INSERT INTO event_info (event_name, event_desc, responsible_person)
            VALUES (%s, %s, %s)
        """
        cursor.execute(sql, (
            data['event_name'],
            data.get('event_desc'),
            # Ensure empty string becomes NULL if desired, or handle in DB schema/frontend
            data.get('responsible_person') if data.get('responsible_person') else None
        ))
        conn.commit()
        new_event_id = cursor.lastrowid

        # Retrieve the newly created event with statistics to return
        cursor.execute("""
             SELECT
                e.event_id, e.event_name, e.event_desc, e.create_time, e.update_time,
                e.responsible_person, e.event_del_status, e.event_mark_status,
                COALESCE(s.event_status, 0) as event_status,
                COALESCE(s.total_duration_seconds, 0) as total_duration_seconds,
                s.last_start_time, s.last_stop_time
            FROM event_info e
            LEFT JOIN event_statistics s ON e.event_id = s.event_id
            WHERE e.event_id = %s
        """, (new_event_id,))
        new_event_dict = cursor.fetchone()

        if new_event_dict:
             # Format datetime and Decimal
            for key, value in new_event_dict.items():
                if isinstance(value, datetime):
                    new_event_dict[key] = value.isoformat()
                if isinstance(value, Decimal):
                    new_event_dict[key] = float(value)
            return jsonify(new_event_dict), 201
        else:
            # This case should ideally not happen if insert succeeded
             print(f"Warning: Could not retrieve newly inserted event with ID {new_event_id}")
             return jsonify({"message": "Event created, but failed to retrieve details.", "event_id": new_event_id}), 201


    except mysql.connector.Error as err:
        conn.rollback()
        print(f"Error adding event: {err}")
        # Check for specific errors like duplicate entry if needed
        return jsonify({"error": f"Failed to add event: {err}"}), 500
    finally:
        cursor.close()
        conn.close()

# 3. 更新事件信息 (No changes needed based on requests, but ensure responsible_person update works)
@app.route('/api/events/<int:event_id>', methods=['PUT'])
def update_event(event_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided for update"}), 400

    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor(dictionary=True) # Use dictionary cursor

    fields_to_update = []
    params = []

    # Check allowed update fields
    if 'event_name' in data:
        fields_to_update.append("event_name = %s")
        params.append(data['event_name'])
    if 'event_desc' in data:
        fields_to_update.append("event_desc = %s")
        params.append(data.get('event_desc')) # Allow setting description to empty
    if 'responsible_person' in data:
        fields_to_update.append("responsible_person = %s")
        # Allow setting person to empty/null
        params.append(data.get('responsible_person') if data.get('responsible_person') else None)
    if 'event_mark_status' in data:
        fields_to_update.append("event_mark_status = %s")
        params.append(int(data['event_mark_status']))
    if 'event_del_status' in data:
        fields_to_update.append("event_del_status = %s")
        params.append(int(data['event_del_status']))

    if not fields_to_update:
        return jsonify({"message": "No valid fields provided for update"}), 400

    # Add update_time manually if not automatically handled by DB ON UPDATE CURRENT_TIMESTAMP
    # fields_to_update.append("update_time = NOW()") # Uncomment if needed

    sql = f"UPDATE event_info SET {', '.join(fields_to_update)} WHERE event_id = %s"
    params.append(event_id)

    try:
        cursor.execute(sql, tuple(params))
        conn.commit()
        if cursor.rowcount == 0:
            # Check if the event actually exists before saying "not found"
            cursor.execute("SELECT event_id FROM event_info WHERE event_id = %s", (event_id,))
            if not cursor.fetchone():
                return jsonify({"error": "Event not found"}), 404
            else:
                 # Rowcount is 0 but event exists, means no data actually changed
                 return jsonify({"message": "No changes detected"}), 200 # Or return updated data anyway

        # Return updated event info
        cursor.execute("""
             SELECT
                e.event_id, e.event_name, e.event_desc, e.create_time, e.update_time,
                e.responsible_person, e.event_del_status, e.event_mark_status,
                COALESCE(s.event_status, 0) as event_status,
                COALESCE(s.total_duration_seconds, 0) as total_duration_seconds,
                s.last_start_time, s.last_stop_time
            FROM event_info e
            LEFT JOIN event_statistics s ON e.event_id = s.event_id
            WHERE e.event_id = %s
        """, (event_id,))
        updated_event_dict = cursor.fetchone()
        if updated_event_dict:
             # Format datetime and Decimal
            for key, value in updated_event_dict.items():
                if isinstance(value, datetime):
                    updated_event_dict[key] = value.isoformat()
                if isinstance(value, Decimal):
                    updated_event_dict[key] = float(value)
            return jsonify(updated_event_dict)
        else:
             # Should not happen if update was successful
             return jsonify({"error": "Failed to retrieve updated event after update"}), 500

    except mysql.connector.Error as err:
        conn.rollback()
        print(f"Error updating event {event_id}: {err}")
        return jsonify({"error": f"Failed to update event: {err}"}), 500
    finally:
        cursor.close()
        conn.close()

# 4. 删除事件 (软删除) (No changes needed based on requests)
@app.route('/api/events/<int:event_id>', methods=['DELETE'])
def delete_event(event_id):
    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor(dictionary=True) # Use dictionary cursor
    try:
        # Check if event exists before attempting delete/update
        cursor.execute("SELECT event_id, event_del_status FROM event_info WHERE event_id = %s", (event_id,))
        event_info_rec = cursor.fetchone()
        if not event_info_rec:
            return jsonify({"error": "Event not found"}), 404
        if event_info_rec['event_del_status'] == 0:
             # Optionally, allow restoring or just return a message
             return jsonify({"message": f"Event {event_id} is already deleted"}), 200


        # Soft delete
        sql = "UPDATE event_info SET event_del_status = 0 WHERE event_id = %s"
        cursor.execute(sql, (event_id,))

        # If event was running, stop it
        cursor.execute("SELECT event_status FROM event_statistics WHERE event_id = %s", (event_id,))
        stat_rec = cursor.fetchone()
        if stat_rec and stat_rec['event_status'] == 1:
             now = datetime.now()
             # Insert log first (optional but good practice)
             cursor.execute("INSERT INTO event_logs (event_id, log_type, log_time) VALUES (%s, 0, %s)", (event_id, now))
             # Update stats
             if not update_event_statistics(cursor, event_id, 0, now):
                  conn.rollback()
                  return jsonify({"error": "Failed to stop running event during deletion"}), 500

        conn.commit()
        return jsonify({"message": f"Event {event_id} marked as deleted"}), 200

    except mysql.connector.Error as err:
        conn.rollback()
        print(f"Error deleting event {event_id}: {err}")
        return jsonify({"error": f"Failed to delete event: {err}"}), 500
    finally:
        cursor.close()
        conn.close()

# 5. 记录事件日志 (开始/结束) 并更新统计 (No changes needed based on requests)
@app.route('/api/events/<int:event_id>/log', methods=['POST'])
def log_event_action(event_id):
    data = request.get_json()
    log_type = data.get('log_type') # 1 for start, 0 for stop

    if log_type not in [0, 1]:
        return jsonify({"error": "Invalid log_type. Use 1 for start, 0 for stop."}), 400

    conn = get_db_connection()
    if not conn: return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor(dictionary=True) # Use dictionary cursor

    try:
        # Check event exists and is not deleted
        cursor.execute("SELECT event_id, event_del_status FROM event_info WHERE event_id = %s", (event_id,))
        event_info_rec = cursor.fetchone()
        if not event_info_rec:
            conn.close() # Close connection before returning
            return jsonify({"error": "Event not found"}), 404
        if event_info_rec['event_del_status'] == 0:
            conn.close()
            return jsonify({"error": "Cannot log action for a deleted event"}), 400

        # Check current status to prevent conflicts
        cursor.execute("SELECT event_status FROM event_statistics WHERE event_id = %s", (event_id,))
        stat_rec = cursor.fetchone()
        current_status = stat_rec['event_status'] if stat_rec else 0 # Assume stopped if no record

        if log_type == 1 and current_status == 1:
            conn.close()
            return jsonify({"error": "Event is already running"}), 409 # Conflict
        if log_type == 0 and current_status == 0:
            # Check if it ever started - consult last_start_time?
            # For simplicity, allow stopping an already stopped event (idempotent),
            # or return conflict. Let's allow it for now.
            # return jsonify({"error": "Event is already stopped"}), 409 # Conflict
            pass # Allow stopping again, update_statistics handles this

        # Perform logging and update
        now = datetime.now()
        # 1. Insert log record
        cursor.execute("INSERT INTO event_logs (event_id, log_type, log_time) VALUES (%s, %s, %s)",
                       (event_id, log_type, now))
        log_id = cursor.lastrowid

        # 2. Update statistics (function now needs dictionary cursor)
        if not update_event_statistics(cursor, event_id, log_type, now):
             conn.rollback()
             conn.close()
             return jsonify({"error": "Failed to update event statistics"}), 500

        conn.commit()

        # Return updated statistics
        cursor.execute("""
            SELECT event_id, last_start_time, last_stop_time, total_duration_seconds, event_status
            FROM event_statistics WHERE event_id = %s
        """, (event_id,))
        updated_stats = cursor.fetchone()
        if updated_stats:
            # Format datetime and Decimal
            for key, value in updated_stats.items():
                if isinstance(value, datetime):
                    updated_stats[key] = value.isoformat()
                if isinstance(value, Decimal):
                    updated_stats[key] = float(value)

        return jsonify({
            "message": f"Event {event_id} {'started' if log_type == 1 else 'stopped'} successfully",
            "log_id": log_id,
            "log_time": now.isoformat(),
            "statistics": updated_stats
        }), 200

    except mysql.connector.Error as err:
        conn.rollback()
        print(f"Error logging action for event {event_id}: {err}")
        return jsonify({"error": f"Failed to log action: {err}"}), 500
    except Exception as e:
        conn.rollback()
        print(f"Unexpected error logging action: {e}")
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500
    finally:
        if conn and conn.is_connected(): # Check if connection is still valid
             if cursor: cursor.close()
             conn.close()


# 6. 获取 Dashboard 数据 (No changes needed based on requests)
@app.route('/api/dashboard', methods=['GET'])
def get_dashboard_data():
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor(dictionary=True)
    try:
        # 查询标记且未删除的事件
        query = """
            SELECT
                e.event_id, e.event_name, e.event_desc, e.create_time, e.update_time,
                e.responsible_person, e.event_del_status, e.event_mark_status,
                COALESCE(s.event_status, 0) as event_status,
                COALESCE(s.total_duration_seconds, 0) as total_duration_seconds,
                s.last_start_time, s.last_stop_time
            FROM event_info e
            LEFT JOIN event_statistics s ON e.event_id = s.event_id
            WHERE e.event_mark_status = 1 AND e.event_del_status = 1
            -- *** MODIFIED ORDER BY CLAUSE ***
            -- Change from: ORDER BY s.event_status DESC, e.create_time ASC
            -- Change to (for example, sort purely by creation time):
            ORDER BY e.create_time ASC
            -- Or, if you want running ones grouped but stable within groups:
            -- ORDER BY s.event_status DESC, e.create_time ASC
            -- Let's use create_time ASC for stability as requested
        """
        # --- Choose ONE of the ORDER BY options above ---
        # --- Let's proceed with `ORDER BY e.create_time ASC` for stable order ---
        final_query = query.replace("ORDER BY s.event_status DESC, e.create_time ASC", "ORDER BY e.create_time ASC") # Make sure to use the chosen order

        cursor.execute(final_query) # Execute the modified query
        dashboard_events = cursor.fetchall()
        # Format datetime and Decimal
        for event in dashboard_events:
            for key, value in event.items():
                if isinstance(value, datetime):
                    event[key] = value.isoformat()
                if isinstance(value, Decimal):
                    event[key] = float(value)
        return jsonify(dashboard_events)
    except mysql.connector.Error as err:
        print(f"Error fetching dashboard data: {err}")
        return jsonify({"error": f"Failed to fetch dashboard data: {err}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# 7. 获取单个事件详情 (No changes needed based on requests)
@app.route('/api/events/<int:event_id>', methods=['GET'])
def get_event_details(event_id):
    # This endpoint might be implicitly used by edit functionality, ensure it's working
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor(dictionary=True)
    try:
        query = """
            SELECT
                e.event_id, e.event_name, e.event_desc, e.create_time, e.update_time,
                e.responsible_person, e.event_del_status, e.event_mark_status,
                COALESCE(s.event_status, 0) as event_status,
                COALESCE(s.total_duration_seconds, 0) as total_duration_seconds,
                s.last_start_time, s.last_stop_time
            FROM event_info e
            LEFT JOIN event_statistics s ON e.event_id = s.event_id
            WHERE e.event_id = %s
        """
        cursor.execute(query, (event_id,))
        event = cursor.fetchone()

        if not event:
            return jsonify({"error": "Event not found"}), 404

        # Format datetime and Decimal
        for key, value in event.items():
            if isinstance(value, datetime):
                event[key] = value.isoformat()
            if isinstance(value, Decimal):
                event[key] = float(value)

        return jsonify(event)

    except mysql.connector.Error as err:
        print(f"Error fetching event details for {event_id}: {err}")
        return jsonify({"error": f"Failed to fetch event details: {err}"}), 500
    except Exception as e:
         print(f"Unexpected error fetching event details {event_id}: {e}")
         return jsonify({"error": f"An unexpected error occurred: {e}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# 8. NEW: Get Distinct Responsible Persons
@app.route('/api/persons', methods=['GET'])
def get_responsible_persons():
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database connection failed"}), 500
    cursor = conn.cursor() # No dictionary needed, just fetching one column
    try:
        query = """
            SELECT DISTINCT responsible_person
            FROM event_info
            WHERE responsible_person IS NOT NULL AND responsible_person != ''
            ORDER BY responsible_person ASC
        """
        cursor.execute(query)
        persons = [row[0] for row in cursor.fetchall()]
        return jsonify(persons)
    except mysql.connector.Error as err:
        print(f"Error fetching responsible persons: {err}")
        return jsonify({"error": f"Failed to fetch persons: {err}"}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()


# --- 前端页面路由 ---
@app.route('/')
def index():
    return render_template('index.html')

# --- 运行 Flask 应用 ---
if __name__ == '__main__':
    # 监听所有网络接口，端口 5000
    # debug=True 会在代码变动时自动重启服务，但生产环境不要开启
    app.run(host='127.0.0.1', port=5000, debug=False) # Keep debug=False for production/testing stability
