import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js" 

import { create } from "./elements.js";
import { get_node } from "./utilities.js";
import { SliderOverrides } from "./input_slider.js";
import { GroupManager } from "./groups.js";

import { UpdateController } from "./update_controller.js";
import { NodeBlock } from "./nodeblock.js";
import { get_resizable_heights, observe_resizables, restore_heights } from "./resize_manager.js";
import { Debug } from "./debug.js";

import { NodeInclusionManager } from "./node_inclusion.js";
import { settings } from "./settings.js";

export class ControllerPanel extends HTMLDivElement {
    static instance = undefined
    constructor() {
        super()
        if (ControllerPanel.instance) { ControllerPanel.instance.remove() }
        ControllerPanel.instance = this
        this.classList.add("controller")
        document.body.appendChild(this);
        
        this.node_blocks = {}   // map from node.id to NodeBlock
        
        if (ControllerPanel.showing()) ControllerPanel.redraw()
        else ControllerPanel.hide()

        this.addEventListener('dragstart', (e) => { this.classList.add('unrefreshable'); this.reason = 'drag happening' })
        this.addEventListener('dragend',   (e) => { this.save_node_order(); this.classList.remove('unrefreshable') } )
        this.addEventListener('dragover',  (e) => {
            if (NodeBlock.dragged) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.dropEffect = "move"
            }
        })
    }

    static toggle() {
        if (ControllerPanel.instance) {
            if (ControllerPanel.showing()) ControllerPanel.hide()
            else ControllerPanel.redraw()
        }
    }

    static showing() { 
        try {
            return (settings.showing)
        } catch { return false; }
    }

    static redraw() {
        Debug.trivia("In ControllerPanel.show")
        ControllerPanel.instance.build_controllerPanel()
        ControllerPanel.instance.classList.remove('hidden')
        settings.showing = true
    }

    static hide() {
        ControllerPanel.instance.classList.add('hidden')
        try { settings.showing = false } catch { Debug.trivia("settings exception in hide") }
    }

    static force_redraw() {
        const temp = create('span',null,ControllerPanel.instance.main_container)
        setTimeout(()=>{temp.remove()}, 100)
    }

    static graph_cleared() {
        settings.initialise()
        UpdateController.make_request()
    }

    static on_setup() {
        settings.load()

        const draw = LGraphCanvas.prototype.draw;
        LGraphCanvas.prototype.draw = function() {
            if (ControllerPanel.instance) ControllerPanel.instance.on_update()
            draw.apply(this,arguments);
        }

        UpdateController.setup(ControllerPanel.redraw, ControllerPanel.can_refresh, (node_id)=>ControllerPanel.instance?.node_blocks[node_id])
        const change = app.graph.change
        app.graph.change = function() {
            // UpdateController.make_request()   TODO rethink this
            change.apply(this, arguments)
        }

        NodeInclusionManager.node_change_callback = UpdateController.make_request
        api.addEventListener('graphCleared', ControllerPanel.graph_cleared) 
    }

    static can_refresh() {
        try {
            const unrefreshables = ControllerPanel.instance.getElementsByClassName('unrefreshable')
            if (ControllerPanel.instance.contains( document.activeElement )) {
                Debug.trivia(`Not refreshing because contain active element ${document.activeElement}`)
            } else if (ControllerPanel.instance.classList.contains('unrefreshable')) {
                Debug.extended(`Not refreshing because ControlPanel is marked as unrefreshable because ${ControllerPanel.instance.reason}`)          
            } else if (unrefreshables.length == 1) {
                Debug.extended(`Not refreshing because contains unrefreshable element because ${unrefreshables[0].reason}`)
            } else if (unrefreshables.length > 1) {
                Debug.extended(`Not refreshing because contains ${unrefreshables.length} unrefreshable elements`)
            } else if (!ControllerPanel.showing()) {
                Debug.trivia(`Not refreshing because not visible`)
            } else {
                return true
            }
        } catch (e) {
            Debug.important(`Not refreshing because:`)
            console.error(e)
        }
        return false
    }

    on_update() {
        const qt = document.getElementsByClassName('comfy-menu-queue-size')
        if (this.submit_button) {
            this.submit_button.disabled = ( qt && qt.length>0 && !(qt[0].innerText.includes(' 0')) )
        }
    }

    maybe_create_node_block_for_node(node_or_node_id) {
        const nd = get_node(node_or_node_id)
        if (NodeInclusionManager.include_node(nd)) {
            const node_block = new NodeBlock(nd, this.force_redraw)
            if (node_block.valid_nodeblock) this.node_blocks[nd.id] = node_block
        }
    }

    on_height_change() {
        if (this.updating_heights) return
        Debug.trivia("on_height_change")
        this.updating_heights = true
        settings.heights = get_resizable_heights(this)
        ControllerPanel.force_redraw();
        setTimeout( ()=>{this.updating_heights=false}, 100 )
    }

    consider_adding_node(node_or_node_id) {
        const node_id = (node_or_node_id.id) ? node_or_node_id.id : node_or_node_id
        if (this.new_node_id_list.includes(node_id)) return   // already got it in the new list
        if (NodeInclusionManager.include_node(node_or_node_id)) {             // is it still valid?
            if (this.node_blocks[node_id]) {     
                this.node_blocks[node_id].build_nodeblock()
            } else {
                this.maybe_create_node_block_for_node(node_id) 
            }
            if (this.node_blocks[node_id]) {             // if it now exists, add it
                //this.node_blocks[node_id].on_update()
                this.main_container.append(this.node_blocks[node_id])
                this.new_node_id_list.push(node_id)
            }
        }        
    }

    remove_absent_nodes() {
        Object.keys(this.node_blocks).forEach((node_id) => {
            if (!app.graph._nodes_by_id[node_id]) {
                delete this.node_blocks[node_id]
            }
        })
    }

    set_node_visibility() {
        this.showAdvancedCheckbox = false
        var count_included = 0
        var count_visible  = 0
        Object.keys(this.node_blocks).forEach((node_id) => {
            const node_block = this.node_blocks[node_id]
            if (NodeInclusionManager.include_node(node_block.node)) {
                if (GroupManager.is_node_in(settings.group_choice, node_id)) {
                    count_included += 1
                    if (NodeInclusionManager.advanced_only(node_block.node)) {
                        this.showAdvancedCheckbox = true
                        if (settings.advanced) {
                            node_block.classList.remove('hidden')
                            count_visible += 1
                        } else node_block.classList.add('hidden')
                    } else {
                        node_block.classList.remove('hidden')
                    } 
                } else {
                    node_block.classList.add('hidden')
                }
            }
        })
        return { "nodes":count_included, "visible_nodes":count_visible }
    }

    set_position() {
        const style = { "top":"2vh", "bottom":"", "left":"10px", "justify-content":"", "border":"thin solid white", "border-radius":"4px", "border-width":"thin" }
        if (this.new_menu_position=="Top") {
            const top_element = document.getElementsByClassName('comfyui-body-top')[0].getBoundingClientRect()
            style["top"] = `${top_element.bottom}px`
            const left_element = document.getElementsByClassName('comfyui-body-left')[0].getBoundingClientRect()
            style["left"] = `${left_element.right}px`
            style["border-color"]  = "#353535"
            style["border-radius"] = "0px"
            style["border-width"]  = "0 thick thick 0"
        }
        if (this.new_menu_position=="Bottom") {
            const left_element = document.getElementsByClassName('comfyui-body-left')[0].getBoundingClientRect()
            style["left"] = `${left_element.right}px`
            const bottom_element = document.getElementsByClassName('comfyui-body-bottom')[0].getBoundingClientRect()
            style["bottom"] = `${bottom_element.height}px`
            style["top"] = ""
            style["border-color"]  = "#353535"
            style["border-radius"] = "0px"
            style["border-width"]  = "thick thick 0 0"
            style["justify-content"] = "flex-end"
        }
        Object.assign(this.style, style)
    }

    build_controllerPanel() { 
        this.innerHTML = ""
        this.classList.add('unrefreshable')
        this.reason = 'already refreshing'
        try {
            this._build_controllerPanel()
        } finally {
            this.classList.remove('unrefreshable')
        }
    }

    _build_controllerPanel() {
        try {
            this.style.zIndex = app.graph.nodes.length + 1
        } catch {
            this.style.zIndex = 1000000
        }
        this.new_menu_position = settings.getSettingValue('Comfy.UseNewMenu', "Disabled")
        SliderOverrides.setup()
        GroupManager.setup(  )

        /* 
        Create the top section
        */
        this.header_span = create('span', 'header', this)
        create('span', 'header_title', this.header_span, {"innerText":"Controller"})
        this.header_span.addEventListener('dragover', function (e) { NodeBlock.drag_over_me(e) } )
        this.header_span.drag_id = "header"

        if (GroupManager.any_groups()) {
            this.group_select = create("select", 'header_select', this.header_span) 
            GroupManager.list_group_names().forEach((nm) => this.group_select.add(new Option(nm,nm)))
            this.group_select.value = settings.group_choice
            this.group_select.addEventListener('input', (e)=>{ settings.group_choice = e.target.value; ControllerPanel.redraw() })
        }

        const gc = GroupManager.valid_option(settings.group_choice)
        if (gc != settings.group_choice) settings.group_choice = gc

        /*
        Create the main container
        */
        this.main_container = create('span','controller_main',this)

        this.new_node_id_list = []
        this.remove_absent_nodes()
        settings.node_order.forEach( (n) => {this.consider_adding_node(n)} )
        app.graph._nodes.forEach( (n) => {this.consider_adding_node(n)} )
        if (this.new_node_id_list.length>0) settings.node_order = this.new_node_id_list

        const node_count = this.set_node_visibility()
        observe_resizables( this, this.on_height_change.bind(this) )
        if (settings.heights) restore_heights( this.node_blocks, settings.heights )

        if (node_count.visible_nodes > 0) {
            this.main_container.drag_id = "footer"
            this.main_container.addEventListener("dragover", (e) => {
                if (NodeBlock.dragged) {
                    e.preventDefault()
                    if (e.target==this.main_container) {
                        if (!this.last_dragover) { this.last_dragover = { "timeStamp":e.timeStamp, "x":e.x, "y":e.y } }
                        else {
                            if (Math.abs(e.x-this.last_dragover.x) > 2 || Math.abs(e.y-this.last_dragover.y) > 2) { this.last_dragover = null }
                            else if ((e.timeStamp - this.last_dragover.timeStamp) > 250) NodeBlock.drag_over_me(e)
                        }
                    }
                }
            })
        } else if (node_count.nodes == 0) {
            var keystroke = settings.getSettingValue("Controller.keyboard","C")
            if (keystroke.toUpperCase() == keystroke) keystroke = "Shift-" + keystroke
            const EMPTY_MESSAGE = 
                "<p>Add nodes to the controller by right-clicking the node<br/>and using the Controller Panel submenu</p>" + 
                `<p>Toggle controller visibility with ${keystroke}</p>`
            create('span', 'empty_message', this.main_container, {"innerHTML":EMPTY_MESSAGE})
        }

        /*
        Create the bottom section
        */
        this.footer = create("span","controller_footer",this)
        this.footer.addEventListener('dragover', function (e) { NodeBlock.drag_over_me(e) } )
        this.footer.drag_id = "footer"

        if (this.showAdvancedCheckbox) {
            const add_div = create('div', 'advanced_controls', this.footer)
            this.show_advanced = create("input", "advanced_checkbox", add_div, {"type":"checkbox", "checked":settings.advanced})
            create('span', 'advanced_label', add_div, {"innerText":"Show advanced controls"})
            this.show_advanced.addEventListener('input', function (e) {
                settings.advanced = e.target.checked
                ControllerPanel.redraw()
            }.bind(this))
        }

        if (this.new_menu_position=="Disabled") {
            this.submit_button = create("button","submit_button",this.footer,{"innerText":"Submit"})
            this.submit_button.addEventListener('click', () => { document.getElementById('queue-button').click() } )
        }

        /*
        Finalise
        */
        setTimeout( this.set_position.bind(this), 20 )
    }

    save_node_order() {
        const node_id_list = []
        this.main_container.childNodes.forEach((child)=>{if (child?.node?.id) node_id_list.push(child.node.id)})
        settings.node_order = node_id_list
    }

}

customElements.define('cp-div',  ControllerPanel, {extends: 'div'})

