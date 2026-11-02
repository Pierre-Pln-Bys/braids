// gomx_group.go
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

package main

import (
	"fmt"
	"strings"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

// MxCreateGroup creates an encrypted private room with the given name and
// invites the users (ids one per line); answers with CMxCreateGroupNotify.
func MxCreateGroup(connId int, name string, userIds string) int {
	conn := GetConn(connId)
	if conn == nil {
		return -1
	}

	var invite []id.UserID
	for _, u := range strings.Split(userIds, "\n") {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		if _, _, err := id.UserID(u).Parse(); err != nil {
			CMxCreateGroupNotify(connId, name, false, "", "Not a Matrix user id: "+u)
			return 0
		}
		invite = append(invite, id.UserID(u))
	}

	go func() {
		if !conn.waitReady(time.Minute) {
			CMxCreateGroupNotify(connId, name, false, "", "The account is not connected.")
			return
		}

		ctx, cancel := conn.requestContext()
		defer cancel()
		req := &mautrix.ReqCreateRoom{
			Preset: "private_chat",
			Name:   name,
			Invite: invite,
			InitialState: []*event.Event{{
				Type:    event.StateEncryption,
				Content: event.Content{Parsed: &event.EncryptionEventContent{Algorithm: id.AlgorithmMegolmV1}},
			}},
		}
		resp, err := conn.client.CreateRoom(ctx, req)
		if err != nil {
			LOG_WARNING(fmt.Sprintf("create group failed: %v", err))
			CMxCreateGroupNotify(connId, name, false, "", "Could not create the group: "+err.Error())
			return
		}

		conn.mu.Lock()
		ri := conn.getRoom(resp.RoomID)
		ri.LastTs = time.Now().UnixMilli()
		conn.stateDirty = true
		conn.mu.Unlock()

		conn.updateContact(string(resp.RoomID), name)
		CMxCreateGroupNotify(connId, name, true, string(resp.RoomID), "")
	}()

	return 0
}
