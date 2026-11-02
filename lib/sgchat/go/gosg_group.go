// gosg_group.go
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

	"go.mau.fi/mautrix-signal/pkg/signalmeow"
)

// SgCreateGroup creates a group with the given members (ACI UUIDs, one per
// line) and answers with CSgCreateGroupNotify.
func SgCreateGroup(connId int, name string, userIds string) int {
	go func() {
		client := GetClient(connId)
		if (client == nil) || (GetState(connId) != Connected) {
			CSgCreateGroupNotify(connId, name, false, "", "The account is not connected.")
			return
		}

		group := &signalmeow.Group{
			Title:   name,
			Members: []*signalmeow.GroupMember{{ACI: client.Store.ACI, Role: signalmeow.GroupMember_ADMINISTRATOR}},
			AccessControl: &signalmeow.GroupAccessControl{
				Members:           signalmeow.AccessControl_MEMBER,
				AddFromInviteLink: signalmeow.AccessControl_UNSATISFIABLE,
				Attributes:        signalmeow.AccessControl_MEMBER,
			},
		}
		for _, userId := range strings.Split(userIds, "\n") {
			userId = strings.TrimSpace(userId)
			if userId == "" {
				continue
			}
			aci := StringToUUID(userId)
			if aci.String() == "00000000-0000-0000-0000-000000000000" {
				CSgCreateGroupNotify(connId, name, false, "", "Not a Signal user: "+userId)
				return
			}
			group.Members = append(group.Members, &signalmeow.GroupMember{ACI: aci, Role: signalmeow.GroupMember_DEFAULT})
		}

		if _, err := signalmeow.PrepareGroupCreation(group); err != nil {
			LOG_WARNING(fmt.Sprintf("prepare group failed: %v", err))
			CSgCreateGroupNotify(connId, name, false, "", "Could not create the group: "+err.Error())
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		created, err := client.CreateGroup(ctx, group)
		if err != nil {
			LOG_WARNING(fmt.Sprintf("create group failed: %v", err))
			CSgCreateGroupNotify(connId, name, false, "", "Could not create the group: "+err.Error())
			return
		}

		chatId := string(created.GroupIdentifier)
		CSgNewContactsNotify(connId, chatId, name, "", 0, 0, 0)
		CSgNewChatsNotify(connId, chatId, 0, 0, 0, 0, int(time.Now().Unix()))
		CSgCreateGroupNotify(connId, name, true, chatId, "")
	}()

	return 0
}
