// gowm_group.go
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

// WmCreateGroup creates a group with the given members (user ids, one per
// line) and answers with CWmCreateGroupNotify.
func WmCreateGroup(connId int, name string, userIds string) int {
	go func() {
		client := GetClient(connId)
		if (client == nil) || (GetState(connId) != Connected) {
			CWmCreateGroupNotify(connId, name, false, "", "The account is not connected.")
			return
		}

		var participants []types.JID
		for _, id := range strings.Split(userIds, "\n") {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			jid, err := types.ParseJID(id)
			if err != nil {
				CWmCreateGroupNotify(connId, name, false, "", "Not a WhatsApp user: "+id)
				return
			}
			participants = append(participants, jid)
		}

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		info, err := client.CreateGroup(ctx, whatsmeow.ReqCreateGroup{Name: name, Participants: participants})
		if err != nil {
			LOG_WARNING(fmt.Sprintf("create group failed: %v", err))
			CWmCreateGroupNotify(connId, name, false, "", "Could not create the group: "+err.Error())
			return
		}

		CWmCreateGroupNotify(connId, name, true, GetChatId(client, &info.JID, nil), "")
	}()

	return 0
}
