/**
 * Provides a simple Select list view style API
 * similar to atom space pen views
 */
import React = require("react");
var ReactDOM = require("react-dom");
import Radium = require('radium');
import csx = require('csx');
import {BaseComponent} from "./ui";
import * as ui from "./ui";
import Modal = require('react-modal');
import * as styles from "./styles/styles";
import {debounce, createMap, rangeLimited, getFileName} from "../common/utils";
import {cast, server} from "../socket/socketClient";
import * as commands from "./commands/commands";
import {match, filter as fuzzyFilter} from "fuzzaldrin";
import * as utils from "../common/utils";

/**
 * The singleton select list view
 */
export var selectListView: SelectListView;

type DataItem = any;

export interface Props {
}
export interface State {
    isOpen?: boolean;
    filterValue?: string;
    selectedIndex?: number;

    header?: string;
    data?: DataItem[];
    render?: (t: DataItem, highlighted: JSX.Element[]) => any;
    textify?: (t: DataItem) => string;
    onSelect?: (t: DataItem) => void;
}

@ui.Radium
export class SelectListView extends BaseComponent<Props, State>{

    filteredResults: DataItem[];

    /*
    API sample usage
        this.refs.selectListView.show<ActiveProjectConfigDetails>({
        header: 'Select the active project',
        data: availableProjects,
        render: (d,highlitedText) => <div>{highlitedText}</div>,
        textify: (d) => d.name,
        onSelect: (d) => {
            server.setActiveProjectName({ name: d.name });
            state.setActiveProject(d.name);
            state.setInActiveProject(types.TriState.Unknown);
        }
    });
    */

    /**
     * The main interaction API
     */
    show<T>(args: {
        header: string;
        data: T[];
        render: (t: T, highlighted: JSX.Element[]) => any;
        /** This text will be used for filtering as well as passing to render */
        textify: (t: T) => string;
        onSelect: (t: T) => void;
    }) {
        this.filteredResults = args.data.concat([]);

        this.setState({
            isOpen: true,
            filterValue: '',
            selectedIndex: 0,

            header: args.header,
            data: args.data,
            render: args.render,
            textify: args.textify,
            onSelect: args.onSelect,
        });

        ReactDOM.findDOMNode(this.refs.omniSearchInput).focus();
    }

    maxShowCount = 15;

    constructor(props: Props) {
        super(props);

        this.filteredResults = [];
        this.state = {
            isOpen: false,
            selectedIndex: 0,

            header: '',
            data: [],
        };
    }

    refs: {
        [string: string]: any;
        omniSearch: any;
        omniSearchInput: any;
    }

    componentDidMount() {
        selectListView = this;

        commands.esc.on(()=>{
            this.closeOmniSearch();
        });
    }

    render() {
        let fileList = this.filteredResults;
        let selectedIndex = this.state.selectedIndex;
        let fileListRendered = fileList.map((item, i) => {
            // key = i
            let selected = selectedIndex === i;
            let selectedStyle = selected ? {
                background: '#545454',
                color: 'white'
            } : {};
            return (
                <div key={i} style={[selectedStyle, styles.padded2, styles.hand]} onClick={()=>this.selectIndex(i)}>
                        {this.state.render(item, renderMatchedSegments(this.state.textify(item), this.state.filterValue)) }
                </div>
            );
        });

        return <Modal
            isOpen={this.state.isOpen}
            onRequestClose={this.closeOmniSearch}>
                <div style={[csx.vertical, csx.flex]}>
                    <div style={[csx.horizontal]}>
                        <h4>{this.state.header}</h4>
                        <div style={[csx.flex]}></div>
                        <div style={{fontSize:'0.9rem', color:'grey'} as any}><code style={styles.modal.keyStrokeStyle}>Esc</code> to exit <code style={styles.modal.keyStrokeStyle}>Enter</code> to select</div>
                        </div>

                    <div style={[styles.padded1TopBottom, csx.vertical]}>
                        <input
                            type="text"
                            ref="omniSearchInput"
                            placeholder="Filter"
                            style={styles.Input.inputBlackStyle}
                            onChange={this.onChangeFilter}
                            onKeyDown={this.onChangeSelected}
                            />
                        </div>

                    <div style={[csx.vertical, csx.flex, { overflow: 'auto' }]}>
                        <div style={[csx.vertical]}>
                            {fileListRendered}
                            </div>
                        </div>
                    </div>
            </Modal>
    }

    closeOmniSearch = () => {
        this.setState({ isOpen: false, filterValue: '' });
    };
    onChangeFilter = debounce((e) => {
        let filterValue = ReactDOM.findDOMNode(this.refs.omniSearchInput).value;

        this.filteredResults = getFilteredItems({
            items: this.state.data,
            textify: this.state.textify,
            filterValue
        });

        this.filteredResults = this.filteredResults.slice(0, this.maxShowCount);
        this.setState({ filterValue, selectedIndex: 0 });
    }, 50);
    incrementSelected = debounce(() => {
        this.setState({ selectedIndex: rangeLimited({ num: ++this.state.selectedIndex, min: 0, max: Math.min(this.maxShowCount - 1, this.filteredResults.length - 1), loopAround: true }) });
    }, 0, true);
    decrementSelected = debounce(() => {
        this.setState({ selectedIndex: rangeLimited({ num: --this.state.selectedIndex, min: 0, max: Math.min(this.maxShowCount - 1, this.filteredResults.length - 1), loopAround: true }) });
    }, 0, true);
    onChangeSelected = (e) => {
        if (e.key == 'ArrowUp') {
            e.preventDefault();
            this.decrementSelected();
        }
        if (e.key == 'ArrowDown') {
            e.preventDefault();
            this.incrementSelected();
        }
        if (e.key == 'Enter') {
            e.preventDefault();
            this.selectIndex(this.state.selectedIndex);
        }
    };
    selectIndex = (index: number)=> {
        let result = this.filteredResults[index];
        this.state.onSelect(result);
        this.closeOmniSearch();
    }
}

/**
 * Applies fuzzy filter to the text version of each item returning the matched items
 */
export function getFilteredItems<T>(args: { items: T[], textify: (item: T) => string, filterValue: string }): T[] {

    // Store the items for each text value
    let textValueToItems:{[text:string]:T[]} = Object.create(null);
    args.items.forEach((item) => {
        let text = args.textify(item);
        if (!textValueToItems[text]) textValueToItems[text] = [];
        textValueToItems[text].push(item);
    })

    // Get the unique text values
    let textValues = Object.keys(utils.createMap(args.items.map(args.textify)));

    // filter them
    let filteredTextValues = fuzzyFilter(textValues, args.filterValue);

    return utils.selectMany(filteredTextValues.map((textvalue) => textValueToItems[textvalue]));
}


/**
 * Based on https://github.com/atom/fuzzy-finder/blob/51f1f2415ecbfab785596825a011c1d2fa2658d3/lib/fuzzy-finder-view.coffee#L56-L74
 */
export function renderMatchedSegments(result: string, query: string): JSX.Element[] {
    // A data structure which is efficient to render
    type MatchedSegments = { str: string, matched: boolean }[];

    // local function that creates the *matched segment* data structure
    function getMatchedSegments(result: string, query: string) {
        let matches = match(result, query);
        let matchMap = createMap(matches);
        // collapse contiguous sections into a single `<strong>`
        let currentUnmatchedCharacters = [];
        let currentMatchedCharacters = [];
        let combined: MatchedSegments = [];
        function closeOffUnmatched() {
            if (currentUnmatchedCharacters.length) {
                combined.push({ str: currentUnmatchedCharacters.join(''), matched: false });
                currentUnmatchedCharacters = [];
            }
        }
        function closeOffMatched() {
            if (currentMatchedCharacters.length) {
                combined.push({ str: currentMatchedCharacters.join(''), matched: true });
                currentMatchedCharacters = [];
            }
        }
        result.split('').forEach((c, i) => {
            let isMatched = matchMap[i];
            if (isMatched) {
                if (currentMatchedCharacters.length) {
                    currentMatchedCharacters.push(c);
                }
                else {
                    currentMatchedCharacters = [c]
                    // close off any unmatched characters
                    closeOffUnmatched();
                }
            }
            else {
                if (currentUnmatchedCharacters.length) {
                    currentUnmatchedCharacters.push(c);
                }
                else {
                    currentUnmatchedCharacters = [c]
                    // close off any matched characters
                    closeOffMatched();
                }
            }
        });
        closeOffMatched();
        closeOffUnmatched();
        return combined;
    }

    /**
     * Rendering the matched segment data structure is trivial
     */
    let matched = getMatchedSegments(result, query);
    let matchedStyle = {fontWeight:'bold', color:'#66d9ef'};
    return matched.map((item, i) => {
        return <span key={i} style={item.matched?matchedStyle:{}}>{item.str}</span>;
    });
}
