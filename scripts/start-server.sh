#!/bin/bash

# Stop any process listening on port 5000
echo "Checking for processes on port 5000..."
PID=$(lsof -t -i:5000 2>/dev/null)

if [ -n "$PID" ]; then
    echo "Stopping process $PID on port 5000..."
    kill -9 $PID 2>/dev/null
    sleep 1
    echo "Process stopped."
else
    echo "No process found on port 5000."
fi

# Start the server
echo "Starting server..."
yarn dev
